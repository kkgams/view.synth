import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'

// Exercise the View's transport methods without mounting a Host or generating audio.
const source = readFileSync(new URL('../src/views/view-synth.js', import.meta.url), 'utf8')
const ViewSynth = runInNewContext(source
    .replace(/^import .*\n/, '')
    .replace('export class ViewSynth', 'class ViewSynth')
    .replace("customElements.define('view-synth', ViewSynth)", 'ViewSynth'), {HTMLElement: class {}})

function transport() {
    const icon = {textContent: ''}
    const attributes = {}
    const button = {setAttribute: (name, value) => { attributes[name] = value }, querySelector: () => icon}
    const view = Object.create(ViewSynth.prototype)
    Object.assign(view, {
        header: {querySelector: () => button},
        source: null,
        paused: false,
        playMode: 'song',
        isConnected: true,
        status(text) { this.statusText = text },
    })
    return {view, icon, attributes}
}

test('idle transport starts the selected song or pattern mode', async () => {
    for (const mode of ['song', 'pattern']) {
        const {view, icon, attributes} = transport()
        view.playMode = mode
        view.play = async selected => { assert.equal(selected, mode) }
        view.updateTransport()
        assert.equal(icon.textContent, 'play_arrow')
        assert.equal(attributes['aria-label'], 'Play')
        await view.togglePlayback()
    }
})

test('pause and resume keep the same source and switch the icon and accessible name', async () => {
    const {view, icon, attributes} = transport()
    const calls = []
    const playingSource = {}
    view.source = playingSource
    view.audio = {suspend: async () => calls.push('suspend'), resume: async () => calls.push('resume')}
    view.updateTransport()
    assert.equal(icon.textContent, 'pause')
    assert.equal(attributes['aria-label'], 'Pause')
    await view.togglePlayback()
    assert.equal(view.paused, true)
    assert.equal(icon.textContent, 'play_arrow')
    assert.equal(attributes['aria-label'], 'Resume')
    await view.togglePlayback()
    assert.equal(view.paused, false)
    assert.equal(icon.textContent, 'pause')
    assert.equal(attributes['aria-label'], 'Pause')
    assert.equal(view.source, playingSource)
    assert.deepEqual(calls, ['suspend', 'resume'])
})

test('stopping paused playback clears its source and resets the toggle', () => {
    const {view, icon, attributes} = transport()
    const calls = []
    view.paused = true
    view.source = {stop: () => calls.push('stop'), disconnect: () => calls.push('disconnect')}
    const playingSource = view.source
    view.stop()
    assert.equal(playingSource.onended, null)
    assert.equal(view.source, null)
    assert.equal(view.paused, false)
    assert.equal(icon.textContent, 'play_arrow')
    assert.equal(attributes['aria-label'], 'Play')
    assert.deepEqual(calls, ['stop', 'disconnect'])
})

test('failed audio suspension leaves transport state unchanged', async () => {
    const {view, icon} = transport()
    view.source = {}
    view.audio = {suspend: async () => { throw new Error('suspend failed') }}
    view.updateTransport()
    await assert.rejects(view.togglePlayback(), /suspend failed/)
    assert.equal(view.paused, false)
    assert.equal(icon.textContent, 'pause')
})

test('a source stopped while suspension is pending cannot restore paused state', async () => {
    const {view, icon} = transport()
    let finishSuspending
    view.source = {stop() {}, disconnect() {}}
    view.audio = {suspend: () => new Promise(resolve => { finishSuspending = resolve })}
    const pending = view.togglePlayback()
    view.stop()
    finishSuspending()
    await pending
    assert.equal(view.source, null)
    assert.equal(view.paused, false)
    assert.equal(icon.textContent, 'play_arrow')
})

test('WAV buffer generation does not resume paused playback', async () => {
    const {view} = transport()
    view.paused = true
    let resumed = false
    view.audio = {resume: async () => { resumed = true }}
    assert.equal(await view.context(false), view.audio)
    assert.equal(resumed, false)
    assert.equal(view.paused, true)
})

test('natural completion resets transport; new playback resumes a suspended context', async () => {
    const {view, icon, attributes} = transport()
    const calls = []
    const playingSource = {connect() {}, start() {}, disconnect: () => calls.push('disconnect')}
    const samples = new Float32Array([0, 0.1, 0])
    view.audio = {resume: async () => calls.push('resume'), createBufferSource: () => playingSource, destination: {}}
    view.buffer = () => ({duration: 1, getChannelData: () => samples})
    await view.play('song')
    assert.equal(icon.textContent, 'pause')
    assert.equal(attributes['aria-label'], 'Pause')
    playingSource.onended()
    assert.equal(view.source, null)
    assert.equal(view.paused, false)
    assert.equal(icon.textContent, 'play_arrow')
    assert.equal(attributes['aria-label'], 'Play')
    assert.deepEqual(calls, ['resume', 'disconnect'])
})
