import { registerViewPlugin, unregisterViewPlugin } from '/util/view-plugin.js'

const SYNTH_TEXT = 'autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"'

export class ViewSynth extends HTMLElement {
    constructor() {
        super()
        this.song = createSong()
        this.track = 0
        this.pattern = 0
        this.row = 0
        this.rowAnchor = 0
        this.step = 0
        this.pianoOctave = 4
        this.pianoFocus = 0
        this.previewNote = null
        this.audio = null
        this.source = null
        this.playback = null
        this.playbackFrame = null
        this.paused = false
        this.playMode = 'song'
        this.busy = false
        this.generation = 0
        this.statusText = 'Select pattern rows, then press a piano key to write a note. Export JSON to keep your work.'
    }

    connectedCallback() {
        this.style.display = 'contents'
        this.onClick = event => {
            const button = event.target.closest('button[data-action], g[role="button"][data-action]')
            if (button) void this.perform(() => this.action(button.dataset.action, button))
            else {
                const header = event.target.closest('th[data-track], th[data-action="pattern"]')
                if (header && !this.busy) {
                    this.selectHeader(header)
                    return
                }
                const row = event.target.closest('tr[data-pattern][data-row]')
                if (row && !this.busy) this.selectPatternRow(row, true, event.shiftKey)
                const sequence = event.target.closest('tr[data-step]')
                if (sequence && !this.busy) {
                    const cell = event.target.closest('td[data-sequence-track]')
                    this.selectSequenceRow(sequence, cell ? Number(cell.dataset.sequenceTrack) : this.track, true)
                }
            }
        }
        this.onChange = event => void this.perform(() => this.change(event.target))
        this.onSubmit = event => event.preventDefault()
        this.onKey = event => {
            this.navigateHeaders(event)
            this.navigateSequence(event)
            this.navigateNotes(event)
            this.navigatePiano(event)
        }
        this.render()
        this.addEventListener('click', this.onClick)
        this.addEventListener('change', this.onChange)
        this.addEventListener('submit', this.onSubmit)
        this.addEventListener('keydown', this.onKey)
        registerViewPlugin(this)
    }

    disconnectedCallback() {
        this.generation++
        this.stop()
        if (this.audio) {
            void this.audio.close()
            this.audio = null
        }
        this.removeEventListener('click', this.onClick)
        this.removeEventListener('change', this.onChange)
        this.removeEventListener('submit', this.onSubmit)
        this.removeEventListener('keydown', this.onKey)
        this.unmountHeader()
        void unregisterViewPlugin(this)
    }

    control(selector) {
        const element = this.querySelector(selector)
        if (!element) throw new Error(`Synth is missing required control: ${selector}`)
        return element
    }

    unmountHeader() {
        if (!this.header) return
        this.header.removeEventListener('click', this.onClick)
        this.header.removeEventListener('change', this.onChange)
        this.header.remove()
        this.header = null
    }

    render() {
        this.unmountHeader()
        this.innerHTML = `
            <div slot="header-controls">
                <div role="buttongroup" data-element="file-actions">
                    <button type="button" data-action="import" aria-label="Import JSON"><i aria-hidden="true">folder_open</i></button>
                    <button type="button" data-action="save" aria-label="Export JSON"><i aria-hidden="true">save</i></button>
                    <button type="button" data-action="wav" aria-label="Export WAV"><i aria-hidden="true">audio_file</i></button>
                </div>
                <div role="buttongroup" data-element="tool-actions">
                    <button type="button" data-action="play-pause" aria-label="Play"><i aria-hidden="true">play_arrow</i></button>
                    <button type="button" data-action="stop" aria-label="Stop"><i aria-hidden="true">stop</i></button>
                    <select data-field="play-mode" aria-label="Playback mode"><option value="song">Song</option><option value="pattern">Pattern</option></select>
                </div>
                <label>BPM <input type="number" data-field="bpm" min="40" max="661" step="1" required ${SYNTH_TEXT}></label>
            </div>
            <form aria-label="Synth tracker">
                <table data-layout="separate" aria-label="Synth workspace">
                    <thead><tr><th scope="col">Sequencer</th><td><div role="buttongroup">
                        <button type="button" data-action="add-step" aria-label="Add sequence step"><i aria-hidden="true">add</i></button>
                        <button type="button" data-action="remove-step" aria-label="Remove last sequence step"><i aria-hidden="true">remove</i></button>
                    </div></td><th colspan="8" scope="col" data-element="track-name"></th></tr></thead>
                    <tbody><tr>
                        <td colspan="2" rowspan="3">
                            <table data-element="sequencer" aria-label="Song sequence"></table>
                        </td>
                        <td colspan="8">
                            <table data-layout="separate" data-element="patterns" aria-label="Track patterns"></table>
                        </td>
                    </tr>
                    <tr><td colspan="8"><table data-layout="separate" data-element="instrument" aria-label="Track instrument"></table></td></tr>
                    <tr><td colspan="8"><svg data-element="piano" role="group" aria-label="Instrument preview keyboard" viewBox="0 0 672 104" width="100%" height="104" preserveAspectRatio="none"></svg></td></tr>
                </tbody></table>
            </form>
            <footer><output data-element="status" aria-live="polite"></output></footer>`
        // Area header slots accept direct children, not descendants of the View.
        if (!this.parentElement) throw new Error('Synth requires a Host Area parent')
        this.header = this.control('[slot="header-controls"]')
        this.header.addEventListener('click', this.onClick)
        this.header.addEventListener('change', this.onChange)
        this.parentElement.append(this.header)
        this.header.querySelector('[data-field="bpm"]').value = String(Math.round(60 * 44100 / 4 / this.song[0]))
        this.header.querySelector('[data-field="play-mode"]').value = this.playMode
        this.updateTransport()
        this.renderEditor()
        this.status(this.statusText)
    }

    renderEditor() {
        this.renderSequence()
        this.renderPatterns()
        this.renderInstrument()
        this.renderPiano()
        this.updateSelection()
    }

    sequenceSteps() {
        return Math.max(1, ...this.song[1].map(track => track[1].length))
    }

    renderSequence() {
        const steps = this.sequenceSteps()
        this.step = Math.min(this.step, steps - 1)
        this.control('[data-element="sequencer"]').innerHTML = `
            <colgroup><col>${this.song[1].map((_, track) => `<col data-track="${track}" aria-selected="${track === this.track}">`).join('')}</colgroup>
            <thead><tr><th scope="col">#</th>${this.song[1].map((_, track) => `<th scope="col" role="button" data-track="${track}" aria-pressed="${track === this.track}" tabindex="${track === this.track ? 0 : -1}" aria-label="Select track ${track + 1}">${track + 1}</th>`).join('')}</tr></thead>
            <tbody>${Array.from({length: steps}, (_, step) => `<tr data-step="${step}" aria-selected="${step === this.step}" tabindex="${step === this.step ? 0 : -1}" aria-label="Sequence step ${step + 1}"><th scope="row">${step + 1}</th>${this.song[1].map((track, index) => `<td data-sequence-track="${index}">${track[1][step] ?? ''}</td>`).join('')}</tr>`).join('')}</tbody>`
        this.control('[data-action="add-step"]').disabled = steps === 64
        this.control('[data-action="remove-step"]').disabled = this.song[1].every(track => !track[1].length)
    }

    renderPatterns() {
        const patterns = this.song[1][this.track][2]
        this.control('[data-element="patterns"]').innerHTML = `<tbody><tr>${patterns.map((notes, pattern) => `<td>
            <table aria-label="Track ${this.track + 1}, pattern ${pattern + 1}">
                <thead><tr><th colspan="2" scope="col" role="button" data-action="pattern" data-pattern="${pattern}" aria-pressed="${pattern === this.pattern}" tabindex="${pattern === this.pattern ? 0 : -1}" aria-label="Select pattern ${pattern + 1}">Pattern ${pattern + 1}</th></tr></thead>
                <tbody>${notes.map((note, row) => {
                    const selected = pattern === this.pattern && row >= Math.min(this.rowAnchor, this.row) && row <= Math.max(this.rowAnchor, this.row)
                    const active = pattern === this.pattern && row === this.row
                    return `<tr data-pattern="${pattern}" data-row="${row}" aria-selected="${selected}" tabindex="${active ? 0 : -1}" aria-label="Pattern ${pattern + 1}, row ${row + 1}: ${note ? noteName(note) : 'empty'}">
                        <th scope="row">${String(row + 1).padStart(2, '0')}</th><td>${noteName(note)}</td>
                    </tr>`
                }).join('')}</tbody>
            </table>
        </td>`).join('')}</tr></tbody>`
    }

    instrumentGroup(group, title = group) {
        return `<table><thead><tr><th colspan="2" scope="col">${title}</th></tr></thead><tbody>${FIELDS.map(([section, name, max, options], index) => {
            if (section !== group) return ''
            const value = this.song[1][this.track][0][index]
            const attributes = `data-instrument="${index}" aria-label="${group}: ${name}"`
            const input = options ? `<select ${attributes}>${options.map((label, i) => `<option value="${i}" ${i === value ? 'selected' : ''}>${label}</option>`).join('')}</select>`
                : max === 1 ? `<input type="checkbox" ${attributes} ${value ? 'checked' : ''}>`
                : `<input type="range" ${attributes} value="${value}" min="0" max="${max}" step="1">`
            return `<tr><th scope="row">${name}</th><td>${input}</td></tr>`
        }).join('')}</tbody></table>`
    }

    renderInstrument() {
        this.control('[data-element="instrument"]').innerHTML = `<tbody><tr>
            <td>${this.instrumentGroup('Oscillator 1', 'OSC 1')}${this.instrumentGroup('Oscillator 2', 'OSC 2')}</td>
            <td>${this.instrumentGroup('Envelope', 'ENV')}${this.instrumentGroup('LFO')}</td>
            <td>${this.instrumentGroup('Effects', 'FX')}
                <table><thead><tr><th colspan="2" scope="col">Preset</th></tr></thead><tbody>
                    <tr><td colspan="2"><select data-field="preset" aria-label="Instrument preset"><option value="">Choose preset</option>${Object.keys(PRESETS).map(name => `<option>${name}</option>`).join('')}</select></td></tr>
                </tbody></table>
            </td>
        </tr></tbody>`
    }

    renderPiano() {
        const first = parseNote(`C${this.pianoOctave}`)
        let white = 0
        const keys = Array.from({length: 36}, (_, index) => {
            const note = first + index
            const black = [1, 3, 6, 8, 10].includes(index % 12)
            const x = black ? 40 + white * 30 - 9 : 40 + white++ * 30
            const label = noteName(note)
            return {black, html: `<g role="button" data-action="piano-note" data-note="${note}" tabindex="${index === this.pianoFocus ? 0 : -1}" aria-label="Write ${label} and preview" aria-pressed="false">
                <rect x="${x}" y="2" width="${black ? 18 : 30}" height="${black ? 60 : 100}" rx="1" fill="${black ? '#222' : '#eee'}" stroke="#555"/>
                <text x="${x + (black ? 9 : 15)}" y="${black ? 51 : 92}" text-anchor="middle" font-size="${black ? 8 : 10}" fill="${black ? '#eee' : '#222'}" pointer-events="none" aria-hidden="true">${label}</text>
            </g>`}
        })
        const controls = [1, -1].map(offset => {
            const disabled = this.pianoOctave + offset < 0 || this.pianoOctave + offset > 7
            const y = offset === 1 ? 2 : 72
            return `<g role="button" data-action="piano-octave" data-offset="${offset}" tabindex="${disabled ? -1 : 0}" aria-label="Octave ${offset === 1 ? 'up' : 'down'}" aria-disabled="${disabled}" opacity="${disabled ? 0.35 : 1}">
                <rect x="2" y="${y}" width="32" height="30" fill="var(--surface)" stroke="currentColor"/>
                <path d="${offset === 1 ? 'M 10 22 L 18 12 L 26 22 Z' : 'M 10 82 L 18 92 L 26 82 Z'}" fill="currentColor" pointer-events="none"/>
            </g>`
        }).join('')
        this.control('[data-element="piano"]').innerHTML = `${controls}<text x="18" y="57" text-anchor="middle" font-size="16" fill="currentColor" aria-label="Starting octave ${this.pianoOctave}">${this.pianoOctave}</text>${keys.filter(key => !key.black).map(key => key.html).join('')}${keys.filter(key => key.black).map(key => key.html).join('')}`
        this.updatePiano()
    }

    updatePiano() {
        const first = parseNote(`C${this.pianoOctave}`)
        this.querySelectorAll('g[data-action="piano-note"]').forEach(key => {
            const note = Number(key.dataset.note)
            const pressed = Boolean(this.source) && !this.paused && this.previewNote === note
            const black = [1, 3, 6, 8, 10].includes((note - first) % 12)
            key.setAttribute('aria-pressed', String(pressed))
            key.setAttribute('tabindex', note - first === this.pianoFocus ? '0' : '-1')
            key.querySelector('rect').setAttribute('fill', pressed ? (black ? '#b56b16' : '#ffc66d') : black ? '#222' : '#eee')
        })
    }

    navigatePiano(event) {
        const current = event.target.closest('g[role="button"][data-action]')
        if (!current || this.busy || event.altKey || event.ctrlKey || event.metaKey) return
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            event.stopPropagation()
            if (!event.repeat) void this.perform(() => this.action(current.dataset.action, current))
        } else if (current.dataset.action === 'piano-note' && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault()
            event.stopPropagation()
            const index = Number(current.dataset.note) - parseNote(`C${this.pianoOctave}`)
            this.pianoFocus = event.key === 'Home' ? 0 : event.key === 'End' ? 35 : Math.max(0, Math.min(35, index + (event.key === 'ArrowLeft' ? -1 : 1)))
            this.updatePiano()
            this.control(`g[data-note="${parseNote(`C${this.pianoOctave}`) + this.pianoFocus}"]`).focus()
        }
    }

    updateSelection() {
        this.updatePiano()
        const position = this.playbackPosition()
        const step = position ? position.step : this.step
        const pattern = position ? position.pattern : this.pattern
        const firstRow = position ? position.row : Math.min(this.rowAnchor, this.row)
        const lastRow = position ? position.row : Math.max(this.rowAnchor, this.row)
        this.control('[data-element="track-name"]').textContent = `Track ${this.track + 1}`
        this.querySelectorAll('col[data-track], th[data-track]').forEach(element => {
            const selected = Number(element.dataset.track) === this.track
            element.setAttribute(element.tagName === 'TH' ? 'aria-pressed' : 'aria-selected', String(selected))
            if (element.tagName === 'TH') element.tabIndex = selected ? 0 : -1
        })
        this.querySelectorAll('th[data-action="pattern"]').forEach(header => {
            const pressed = Number(header.dataset.pattern) === this.pattern
            header.setAttribute('aria-pressed', String(pressed))
            header.tabIndex = pressed ? 0 : -1
        })
        this.querySelectorAll('tr[data-step]').forEach(row => {
            row.setAttribute('aria-selected', String(Number(row.dataset.step) === step))
            // Playback changes the highlight, not the user's keyboard destination.
            row.tabIndex = Number(row.dataset.step) === this.step ? 0 : -1
        })
        this.querySelectorAll('tr[data-pattern][data-row]').forEach(row => {
            const selected = Number(row.dataset.pattern) === pattern && Number(row.dataset.row) >= firstRow && Number(row.dataset.row) <= lastRow
            row.setAttribute('aria-selected', String(selected))
            row.tabIndex = Number(row.dataset.pattern) === this.pattern && Number(row.dataset.row) === this.row ? 0 : -1
        })
    }

    selectTrack(track) {
        if (track === this.track) return
        this.track = track
        this.rowAnchor = this.row
        this.renderPatterns()
        this.renderInstrument()
        this.updateSelection()
    }

    selectSequenceRow(row, track = this.track, focus = false) {
        this.step = Number(row.dataset.step)
        this.selectTrack(track)
        const pattern = this.song[1][this.track][1][this.step]
        if (pattern) this.setPattern(pattern - 1)
        this.updateSelection()
        if (focus) row.focus()
    }

    setPattern(pattern) {
        if (pattern === this.pattern) return
        this.pattern = pattern
        this.rowAnchor = this.row
    }

    selectPatternRow(row, focus = false, extend = false) {
        const pattern = Number(row.dataset.pattern)
        const index = Number(row.dataset.row)
        // Ranges belong to one pattern; Shift into another starts a new range.
        if (!extend || pattern !== this.pattern) this.rowAnchor = index
        this.pattern = pattern
        this.row = index
        this.updateSelection()
        if (focus) row.focus()
    }

    status(text, error = false) {
        this.statusText = text
        const output = this.control('[data-element="status"]')
        output.textContent = text
        output.classList.toggle('danger', error)
    }

    async perform(operation) {
        if (this.busy) return
        this.busy = true
        try {
            await operation()
        } catch (error) {
            // File input and user-authored synth values can fail; surface the error.
            this.status(error.message, true)
            console.error(error)
        } finally {
            this.busy = false
        }
    }

    change(input) {
        if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
            input.setCustomValidity('')
        }
        try {
            if (input.matches('[data-instrument]')) {
                const index = Number(input.dataset.instrument)
                const value = input.type === 'checkbox' ? Number(input.checked) : Number(input.value)
                if (input.value === '' && input.type !== 'checkbox') throw new Error('Instrument values cannot be empty')
                const instrument = [...this.song[1][this.track][0]]
                instrument[index] = value
                this.song[1][this.track][0] = normalizeInstrument(instrument)
            } else if (input.dataset.field === 'play-mode') {
                if (!['song', 'pattern'].includes(input.value)) throw new Error('Unknown playback mode')
                this.playMode = input.value
                this.stop()
                this.status(`Ready to play ${this.playMode}.`)
                return
            } else if (input.dataset.field === 'bpm') {
                const bpm = input.valueAsNumber
                if (!Number.isInteger(bpm) || bpm < 40 || bpm > 661) throw new Error('Tempo must be an integer from 40 to 661 BPM')
                this.song[0] = Math.round(60 * 44100 / 4 / bpm)
            } else if (input.dataset.field === 'preset' && input.value) {
                if (!Object.hasOwn(PRESETS, input.value)) throw new Error('Unknown instrument preset')
                this.song[1][this.track][0] = normalizeInstrument(PRESETS[input.value])
                this.renderInstrument()
            } else return
            this.stop()
            this.status('Edited. Export JSON to keep your work.')
        } catch (error) {
            if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) input.setCustomValidity(error.message)
            throw error
        }
    }

    selectHeader(header) {
        if (header.getAttribute('aria-disabled') === 'true') return
        if (header.dataset.track !== undefined) this.selectTrack(Number(header.dataset.track))
        else if (header.dataset.action === 'pattern') {
            this.setPattern(Number(header.dataset.pattern))
            this.updateSelection()
        } else throw new Error('Unknown synth header selector')
        header.focus()
    }

    navigateHeaders(event) {
        const current = event.target.closest('th[data-track], th[data-action="pattern"]')
        if (!current || this.busy || event.altKey || !['Enter', ' ', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        event.stopPropagation()
        if (current.getAttribute('aria-disabled') === 'true') return
        const selector = current.dataset.track !== undefined ? 'th[data-track]' : 'th[data-action="pattern"]'
        const headers = [...this.querySelectorAll(selector)].filter(header => header.getAttribute('aria-disabled') !== 'true')
        let index = headers.indexOf(current)
        if (index < 0) throw new Error('Header selector is missing from the synth')
        if (event.key === 'Home') index = 0
        else if (event.key === 'End') index = headers.length - 1
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') index = Math.max(0, Math.min(headers.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1)))
        this.selectHeader(headers[index])
    }

    navigateSequence(event) {
        const current = event.target.closest('tr[data-step]')
        if (!current || this.busy || event.altKey || !['Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        event.stopPropagation()
        let step = Number(current.dataset.step)
        let track = this.track
        if (event.key === 'Home') step = 0
        else if (event.key === 'End') step = this.sequenceSteps() - 1
        else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') step = Math.max(0, Math.min(this.sequenceSteps() - 1, step + (event.key === 'ArrowUp' ? -1 : 1)))
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') track = Math.max(0, Math.min(7, track + (event.key === 'ArrowLeft' ? -1 : 1)))
        this.selectSequenceRow(this.control(`tr[data-step="${step}"]`), track, true)
    }

    navigateNotes(event) {
        const current = event.target.closest('tr[data-pattern][data-row]')
        if (!current || this.busy || event.altKey || !['Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        event.stopPropagation()
        const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight'
        let row = Number(current.dataset.row)
        let pattern = Number(current.dataset.pattern)
        if (event.key === 'Home' || event.key === 'End') {
            row = event.key === 'Home' ? 0 : 31
            if (event.ctrlKey || event.metaKey) pattern = event.key === 'Home' ? 0 : 8
        } else if (horizontal) {
            pattern = Math.max(0, Math.min(8, pattern + (event.key === 'ArrowLeft' ? -1 : 1)))
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            row = Math.max(0, Math.min(31, row + (event.key === 'ArrowUp' ? -1 : 1)))
        }
        this.selectPatternRow(this.control(`tr[data-pattern="${pattern}"][data-row="${row}"]`), true, event.shiftKey)
    }

    playbackPosition() {
        if (!this.playback) return null
        const playback = this.playback
        const elapsed = Math.max(0, this.audio.currentTime - playback.startedAt)
        const absoluteRow = Math.floor(elapsed * 44100 / playback.rowLength)
        const steps = playback.mode === 'song' ? Math.max(...playback.sequences.map(sequence => sequence.length)) : 1
        // Envelope and delay tails are audible, but no new rows are being played.
        if (absoluteRow >= steps * 32) return {step: null, pattern: null, row: null}
        if (playback.mode === 'pattern') {
            return {step: null, pattern: this.track === playback.track ? playback.pattern : null, row: absoluteRow}
        }
        const step = Math.floor(absoluteRow / 32)
        const pattern = playback.sequences[this.track][step]
        return {step, pattern: pattern ? pattern - 1 : null, row: absoluteRow % 32}
    }

    cancelPlaybackFrame() {
        if (this.playbackFrame !== null) {
            cancelAnimationFrame(this.playbackFrame)
            this.playbackFrame = null
        }
    }

    startPlaybackUpdates() {
        this.cancelPlaybackFrame()
        if (!this.playback || this.paused) return
        const playback = this.playback
        let lastPosition = ''
        const tick = () => {
            if (this.playback !== playback || !this.isConnected || this.paused) return
            this.playbackFrame = null
            const position = JSON.stringify([this.track, this.playbackPosition()])
            if (position !== lastPosition) {
                lastPosition = position
                this.updateSelection()
            }
            this.playbackFrame = requestAnimationFrame(tick)
        }
        tick()
    }

    clearPlayback() {
        this.cancelPlaybackFrame()
        this.playback = null
        if (this.isConnected) this.updateSelection()
    }

    updateTransport() {
        // The header is absent after disconnect and before the initial render.
        if (!this.header) return
        const button = this.header.querySelector('[data-action="play-pause"]')
        if (!button) throw new Error('Synth is missing its playback toggle')
        const playing = Boolean(this.source) && !this.paused
        button.setAttribute('aria-label', playing ? 'Pause' : this.paused ? 'Resume' : 'Play')
        button.querySelector('i').textContent = playing ? 'pause' : 'play_arrow'
    }

    async togglePlayback() {
        if (!this.source) { await this.play(this.playMode); return }
        const audio = this.audio
        if (!audio) throw new Error('Playback requires an audio context')
        const source = this.source
        const paused = !this.paused
        if (paused) await audio.suspend()
        else await audio.resume()
        if (!this.isConnected || this.source !== source) return
        this.paused = paused
        if (paused) {
            this.cancelPlaybackFrame()
        } else this.startPlaybackUpdates()
        this.updateSelection()
        this.updateTransport()
        this.status(paused ? 'Playback paused.' : 'Playback resumed.')
    }

    stop() {
        if (this.source) {
            this.source.onended = null
            this.source.stop()
            this.source.disconnect()
            this.source = null
        }
        this.paused = false
        this.clearPlayback()
        this.updateTransport()
    }

    async context(resume = true) {
        if (!this.audio) this.audio = new AudioContext()
        const audio = this.audio
        if (resume) await audio.resume()
        // A layout close can happen while the operating system resumes audio.
        return this.isConnected && this.audio === audio ? audio : null
    }

    buffer(audio, mode, note = 147) {
        const synth = pl_synth_init(audio)
        const track = this.song[1][this.track]
        if (mode === 'note') {
            renderLength([this.song[0], [[track[0], [1], []]]])
            return synth.sound([...track[0]], note, this.song[0])
        }
        const data = mode === 'pattern' ? [this.song[0], [[track[0], [1], [track[2][this.pattern]]]]] : this.song
        return synth.song(renderSongData(data))
    }

    async play(mode, note) {
        this.stop()
        const audio = await this.context()
        if (!audio) return
        const buffer = this.buffer(audio, mode, note)
        // Check before playback as unstable filter settings can produce NaNs.
        for (let channel = 0; channel < 2; channel++) {
            if (!buffer.getChannelData(channel).every(Number.isFinite)) throw new Error('Synth produced non-finite audio; adjust the instrument')
        }
        const source = audio.createBufferSource()
        source.buffer = buffer
        source.connect(audio.destination)
        this.source = source
        source.onended = () => {
            if (this.source !== source) return
            source.disconnect()
            this.source = null
            this.paused = false
            this.clearPlayback()
            this.updateTransport()
            this.status('Playback finished.')
        }
        const startedAt = audio.currentTime
        if (mode !== 'note') {
            // Snapshot the rendered arrangement; changing the viewed track must not
            // change which pattern the already-generated audio is playing.
            this.playback = {
                mode, startedAt, rowLength: this.song[0], track: this.track, pattern: this.pattern,
                sequences: this.song[1].map(track => [...track[1]]),
            }
        }
        source.start(startedAt)
        this.previewNote = mode === 'note' ? note : null
        this.updateSelection()
        this.startPlaybackUpdates()
        this.updateTransport()
        this.status(`Playing ${mode} (${buffer.duration.toFixed(1)} seconds).`)
    }

    download(name, data, type) {
        const url = URL.createObjectURL(new Blob([data], {type}))
        const link = document.createElement('a')
        link.href = url
        link.download = name
        document.body.append(link)
        link.click()
        link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
    }

    async importSong() {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.json,application/json'
        input.hidden = true
        input.addEventListener('cancel', () => input.remove(), {once: true})
        input.addEventListener('change', () => {
            const file = input.files[0]
            input.remove()
            if (!file) return
            void this.perform(async () => {
                if (file.size > 1024 * 1024) throw new Error('JSON files must be at most 1 MiB')
                const generation = this.generation
                const text = await file.text()
                const song = normalizeSong(JSON.parse(text))
                if (!this.isConnected || this.generation !== generation) return
                this.stop()
                this.song = song
                this.track = 0
                this.pattern = 0
                this.row = 0
                this.rowAnchor = 0
                this.step = 0
                this.render()
                this.status('Imported song. Export JSON before closing to keep further edits.')
            })
        }, {once: true})
        this.append(input)
        input.click()
    }

    async action(action, button) {
        if (action === 'piano-octave') {
            if (button.getAttribute('aria-disabled') === 'true') return
            const offset = Number(button.dataset.offset)
            const octave = this.pianoOctave + offset
            if (![-1, 1].includes(offset) || octave < 0 || octave > 7) throw new Error('Invalid piano octave change')
            this.pianoOctave = octave
            this.renderPiano()
            const focusOffset = octave + offset < 0 || octave + offset > 7 ? -offset : offset
            this.control(`g[data-action="piano-octave"][data-offset="${focusOffset}"]`).focus()
            return
        }
        const transportActive = action === 'play-pause' && this.source
        if (action !== 'stop' && action !== 'import' && !transportActive) {
            if (!this.control('form').reportValidity()) return
            const bpm = this.header.querySelector('[data-field="bpm"]')
            if (!bpm.reportValidity()) return
        }
        if (action === 'add-step' || action === 'remove-step') {
            const steps = this.sequenceSteps()
            if (action === 'add-step') {
                if (steps === 64) throw new Error('Sequences are limited to 64 steps')
                for (const track of this.song[1]) while (track[1].length <= steps) track[1].push(0)
            } else {
                for (const track of this.song[1]) track[1] = track[1].slice(0, steps - 1)
            }
            this.stop()
            this.renderSequence()
            this.status('Sequence resized. Export JSON to keep your work.')
            return
        }
        if (action === 'play-pause') { await this.togglePlayback(); return }
        if (action === 'stop') { this.stop(); this.status('Stopped.'); return }
        if (action === 'import') { await this.importSong(); return }
        if (action === 'save') {
            this.download('song.json', JSON.stringify(normalizeSong(this.song)), 'application/json')
            this.status('Exported song JSON.')
            return
        }
        if (action === 'wav') {
            // Offline buffer generation must not resume paused playback.
            const audio = await this.context(false)
            if (!audio) return
            this.download('song.wav', encodeWav(this.buffer(audio, 'song')), 'audio/wav')
            this.status('Exported stereo 16-bit WAV at 44100 Hz.')
            return
        }
        if (action === 'piano-note') {
            const note = Number(button.dataset.note)
            const index = note - parseNote(`C${this.pianoOctave}`)
            if (!Number.isInteger(index) || index < 0 || index >= 36) throw new Error('Invalid piano key')
            this.song[1][this.track][2][this.pattern].fill(note, Math.min(this.rowAnchor, this.row), Math.max(this.rowAnchor, this.row) + 1)
            this.renderPatterns()
            this.updateSelection()
            this.pianoFocus = index
            this.updatePiano()
            button.focus()
            await this.play('note', note)
            return
        }
        throw new Error(`Unknown synth action: ${action}`)
    }

    save() { return this.action('save') }
    run() { return this.play('song') }
}

customElements.define('view-synth', ViewSynth)
