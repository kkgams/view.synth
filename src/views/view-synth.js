import { registerViewPlugin, unregisterViewPlugin } from '/util/view-plugin.js'

const SYNTH_TEXT = 'autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"'

export class ViewSynth extends HTMLElement {
    constructor() {
        super()
        this.song = createSong()
        this.track = 0
        this.pattern = 0
        this.tab = 'pattern'
        this.audio = null
        this.source = null
        this.busy = false
        this.generation = 0
        this.statusText = 'Enter notes such as C5 or F#4. Export JSON to keep your work.'
    }

    connectedCallback() {
        this.style.display = 'contents'
        this.onClick = event => {
            const button = event.target.closest('button[data-action]')
            if (button) void this.perform(() => this.action(button.dataset.action, button))
        }
        this.onChange = event => void this.perform(() => this.change(event.target))
        this.onSubmit = event => event.preventDefault()
        this.onKey = event => this.navigateNotes(event)
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
        this.header.remove()
        this.header = null
    }

    render() {
        this.unmountHeader()
        this.innerHTML = `
            <div slot="header-controls">
                <div role="buttongroup" data-element="file-actions">
                    <button type="button" data-action="import">Import JSON</button>
                    <button type="button" data-action="save">Export JSON</button>
                    <button type="button" data-action="wav">Export WAV</button>
                </div>
                <div role="buttongroup" data-element="tool-actions">
                    <button type="button" data-action="song">Play song</button>
                    <button type="button" data-action="pattern">Play pattern</button>
                    <button type="button" data-action="stop">Stop</button>
                </div>
            </div>
            <form aria-label="Synth tracker">
                <fieldset><legend>Editor</legend>
                    <label>Track <select data-field="track">${Array.from({length: 8}, (_, i) => `<option value="${i}">Track ${i + 1}</option>`).join('')}</select></label>
                    <label>Pattern <select data-field="pattern">${Array.from({length: 9}, (_, i) => `<option value="${i}">${i + 1}</option>`).join('')}</select></label>
                    <label>Tempo (BPM) <input type="number" data-field="bpm" min="40" max="661" step="1" required ${SYNTH_TEXT}></label>
                </fieldset>
                <div role="tablist" aria-label="Synth editors">
                    ${['pattern', 'instrument', 'song'].map(tab => `<button type="button" role="tab" data-action="tab" data-tab="${tab}" aria-selected="${this.tab === tab}">${tab[0].toUpperCase() + tab.slice(1)}</button>`).join('')}
                </div>
                <fieldset role="tabpanel" data-element="editor"></fieldset>
            </form>
            <footer><output data-element="status" aria-live="polite"></output></footer>`
        // Area header slots accept direct children, not descendants of the View.
        if (!this.parentElement) throw new Error('Synth requires a Host Area parent')
        this.header = this.control('[slot="header-controls"]')
        this.header.addEventListener('click', this.onClick)
        this.parentElement.append(this.header)
        this.control('[data-field="track"]').value = String(this.track)
        this.control('[data-field="pattern"]').value = String(this.pattern)
        this.control('[data-field="bpm"]').value = String(Math.round(60 * 44100 / 4 / this.song[0]))
        this.renderEditor()
        this.status(this.statusText)
    }

    renderEditor() {
        const editor = this.control('[data-element="editor"]')
        editor.setAttribute('aria-label', `${this.tab} editor`)
        if (this.tab === 'pattern') {
            editor.innerHTML = `<legend>Track ${this.track + 1}, pattern ${this.pattern + 1}</legend>
                <button type="button" data-action="clear">Clear pattern</button>
                <table><caption>32 rows; empty notes are silent. Enter or arrow keys move between rows.</caption>
                    <thead><tr><th scope="col">Row</th><th scope="col">Note</th><th scope="col">Preview</th></tr></thead>
                    <tbody>${this.song[1][this.track][2][this.pattern].map((note, row) => `<tr>
                        <th scope="row">${String(row + 1).padStart(2, '0')}</th>
                        <td><input type="text" data-row="${row}" value="${noteName(note)}" aria-label="Row ${row + 1} note" ${SYNTH_TEXT}></td>
                        <td><button type="button" data-action="row" data-row="${row}" aria-label="Preview row ${row + 1}">Play</button></td>
                    </tr>`).join('')}</tbody></table>`
        } else if (this.tab === 'instrument') {
            editor.innerHTML = `<legend>Track ${this.track + 1} instrument</legend>
                <label>Preset <select data-field="preset"><option value="">Choose preset</option>${Object.keys(PRESETS).map(name => `<option>${name}</option>`).join('')}</select></label>
                <label>Preview note <input type="text" data-field="preview" value="C5" ${SYNTH_TEXT}></label>
                <button type="button" data-action="note">Preview instrument</button>
                ${['Oscillator 1', 'Oscillator 2', 'Envelope', 'Effects', 'LFO'].map(group => `<fieldset><legend>${group}</legend>${FIELDS.map(([section, name, max, options], index) => {
                    if (section !== group) return ''
                    const value = this.song[1][this.track][0][index]
                    const attributes = `data-instrument="${index}" aria-label="${group}: ${name}"`
                    const input = options ? `<select ${attributes}>${options.map((label, i) => `<option value="${i}" ${i === value ? 'selected' : ''}>${label}</option>`).join('')}</select>`
                        : max === 1 ? `<input type="checkbox" ${attributes} ${value ? 'checked' : ''}>`
                        : `<input type="number" ${attributes} value="${value}" min="0" max="${max}" step="1" required ${SYNTH_TEXT}>`
                    return `<label>${name} ${input}</label>`
                }).join('')}</fieldset>`).join('')}`
        } else if (this.tab === 'song') {
            editor.innerHTML = `<legend>Song sequence</legend><table>
                <caption>Pattern numbers 1–9 separated by spaces; 0 is a silent pattern. Up to 64 steps per track.</caption>
                <thead><tr><th scope="col">Track</th><th scope="col">Sequence</th></tr></thead>
                <tbody>${this.song[1].map((track, i) => `<tr><th scope="row">${i + 1}</th><td><textarea data-sequence="${i}" aria-label="Track ${i + 1} sequence" ${SYNTH_TEXT}>${track[1].join(' ')}</textarea></td></tr>`).join('')}</tbody>
                </table>`
        } else throw new Error(`Unknown editor tab: ${this.tab}`)
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
            if (input.matches('[data-row]')) {
                const note = parseNote(input.value)
                this.song[1][this.track][2][this.pattern][Number(input.dataset.row)] = note
                input.value = noteName(note)
            } else if (input.matches('[data-instrument]')) {
                const index = Number(input.dataset.instrument)
                const value = input.type === 'checkbox' ? Number(input.checked) : Number(input.value)
                if (input.value === '' && input.type !== 'checkbox') throw new Error('Instrument values cannot be empty')
                const instrument = [...this.song[1][this.track][0]]
                instrument[index] = value
                this.song[1][this.track][0] = normalizeInstrument(instrument)
            } else if (input.matches('[data-sequence]')) {
                this.song[1][Number(input.dataset.sequence)][1] = parseSequence(input.value)
            } else if (input.dataset.field === 'track' || input.dataset.field === 'pattern') {
                this[input.dataset.field] = Number(input.value)
                this.renderEditor()
                return
            } else if (input.dataset.field === 'bpm') {
                const bpm = input.valueAsNumber
                if (!Number.isInteger(bpm) || bpm < 40 || bpm > 661) throw new Error('Tempo must be an integer from 40 to 661 BPM')
                this.song[0] = Math.round(60 * 44100 / 4 / bpm)
            } else if (input.dataset.field === 'preset' && input.value) {
                if (!Object.hasOwn(PRESETS, input.value)) throw new Error('Unknown instrument preset')
                this.song[1][this.track][0] = normalizeInstrument(PRESETS[input.value])
                this.renderEditor()
            } else return
            this.stop()
            this.status('Edited. Export JSON to keep your work.')
        } catch (error) {
            if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) input.setCustomValidity(error.message)
            throw error
        }
    }

    navigateNotes(event) {
        if (!event.target.matches('input[data-row]') || !['Enter', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
        event.preventDefault()
        event.stopPropagation()
        const input = event.target
        input.dispatchEvent(new Event('change', {bubbles: true}))
        if (!input.checkValidity()) { input.reportValidity(); return }
        const row = Math.max(0, Math.min(31, Number(input.dataset.row) + (event.key === 'ArrowUp' ? -1 : 1)))
        const next = this.control(`input[data-row="${row}"]`)
        next.focus()
        next.select()
    }

    stop() {
        if (this.source) {
            this.source.onended = null
            this.source.stop()
            this.source.disconnect()
            this.source = null
        }
    }

    async context() {
        if (!this.audio) this.audio = new AudioContext()
        const audio = this.audio
        await audio.resume()
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
            this.status('Playback finished.')
        }
        source.start()
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
                this.render()
                this.status('Imported song. Export JSON before closing to keep further edits.')
            })
        }, {once: true})
        this.append(input)
        input.click()
    }

    async action(action, button) {
        if (action !== 'stop' && action !== 'import' && !this.control('form').reportValidity()) return
        if (action === 'tab') {
            this.tab = button.dataset.tab
            this.querySelectorAll('[role="tab"]').forEach(tab => tab.setAttribute('aria-selected', String(tab === button)))
            this.renderEditor()
            return
        }
        if (action === 'stop') { this.stop(); this.status('Stopped.'); return }
        if (action === 'import') { await this.importSong(); return }
        if (action === 'save') {
            this.download('song.json', JSON.stringify(normalizeSong(this.song)), 'application/json')
            this.status('Exported song JSON.')
            return
        }
        if (action === 'clear') {
            this.song[1][this.track][2][this.pattern].fill(0)
            this.stop()
            this.renderEditor()
            this.status('Cleared pattern. Export JSON to keep your work.')
            return
        }
        if (action === 'wav') {
            const audio = await this.context()
            if (!audio) return
            this.download('song.wav', encodeWav(this.buffer(audio, 'song')), 'audio/wav')
            this.status('Exported stereo 16-bit WAV at 44100 Hz.')
            return
        }
        if (action === 'row' || action === 'note') {
            const note = action === 'row' ? this.song[1][this.track][2][this.pattern][Number(button.dataset.row)] : parseNote(this.control('[data-field="preview"]').value)
            if (!note) { this.status('Choose a non-empty note to preview.'); return }
            await this.play('note', note)
            return
        }
        if (action === 'song' || action === 'pattern') { await this.play(action); return }
        throw new Error(`Unknown synth action: ${action}`)
    }

    save() { return this.action('save') }
    run() { return this.play('song') }
}

customElements.define('view-synth', ViewSynth)
