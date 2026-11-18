import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import { encodeWav, loopBuffer, normalizeInstrument, PRESETS, renderLength, renderSongData } from "../src/model.mjs"

// Only the AudioBuffer data contract is supplied: the unmodified vendor engine
// performs all oscillation, envelopes, filtering, mixing and delay itself.
function audioBuffer(numberOfChannels, length, sampleRate) {
    assert.ok(Number.isInteger(length) && length > 0)
    const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length))
    return { numberOfChannels, length, sampleRate, getChannelData: (channel) => channels[channel] }
}

function engine() {
    const source = readFileSync(new URL("../src/vendor/pl_synth.js", import.meta.url), "utf8")
    const scope = {}
    vm.runInNewContext(`${source}; globalThis.init = pl_synth_init`, scope)
    return scope.init({ createBuffer: audioBuffer })
}

function assertAudibleFinite(buffer) {
    assert.equal(buffer.numberOfChannels, 2)
    assert.equal(buffer.sampleRate, 44100)
    for (let channel = 0; channel < 2; channel++) {
        const samples = buffer.getChannelData(channel)
        assert.equal(samples.length, buffer.length)
        let peak = 0
        for (const sample of samples) {
            assert.ok(Number.isFinite(sample), "every DSP output sample must be finite")
            peak = Math.max(peak, Math.abs(sample))
        }
        assert.ok(peak > 0.001, `channel ${channel} is audible`)
    }
}

test("real engine synthesizes finite audible stereo sound for every bundled preset", () => {
    const synth = engine()
    for (const [name, preset] of Object.entries(PRESETS)) {
        const instrument = normalizeInstrument(preset)
        const before = [...instrument]
        const buffer = synth.sound(instrument, 147, 1000)
        assertAudibleFinite(buffer)
        assert.deepEqual(instrument, before, name)
        const delayRepeats = instrument[21] ? Math.ceil(Math.log(0.1) / Math.log(instrument[21] / 255)) : 0
        assert.equal(
            buffer.length,
            instrument[13] + instrument[14] + instrument[15] + delayRepeats * ((instrument[20] * 1000) >> 1),
        )
        assert.equal(encodeWav(buffer).byteLength, 44 + buffer.length * 4)
    }
})

test("real engine renders a multi-track song with silent steps and final-row envelope tails", () => {
    const instrument = normalizeInstrument(PRESETS.Default)
    instrument[13] = 10
    instrument[14] = 100
    instrument[15] = 200
    instrument[20] = 2
    instrument[21] = 128
    const lastRow = Array(32).fill(0)
    lastRow[31] = 147
    const source = [
        1000,
        [
            [instrument, [0, 1], [lastRow]],
            [instrument, [0, 1], [[159]]],
        ],
    ]
    const data = renderSongData(source)
    const buffer = engine().song(data)
    assertAudibleFinite(buffer)
    assert.equal(buffer.length, renderLength(source))
    for (let channel = 0; channel < 2; channel++) {
        const samples = buffer.getChannelData(channel)
        assert.ok(
            samples.subarray(0, 32000).every((sample) => sample === 0),
            "zero sequence step stays silent",
        )
        assert.ok(
            samples.subarray(63000, 63310).some((sample) => sample !== 0),
            "last row is synthesized",
        )
        assert.ok(
            samples.subarray(64000).some((sample) => sample !== 0),
            "delay tail survives sequence end",
        )
    }
    assert.equal(encodeWav(buffer).byteLength, 44 + buffer.length * 4)
})

test("real engine zero-attack and zero-release envelopes remain finite", () => {
    for (const envelope of [
        [0, 100, 0],
        [100, 0, 0],
        [0, 0, 100],
    ]) {
        const instrument = normalizeInstrument(PRESETS.Default)
        instrument.splice(13, 3, ...envelope)
        assertAudibleFinite(engine().sound(instrument))
    }
})

test("WAV emits complete little-endian PCM stereo header and frame-interleaved clipped samples", () => {
    const buffer = audioBuffer(2, 5, 44100)
    buffer.getChannelData(0).set([-2, -1, -0.5, 0, 0.5])
    buffer.getChannelData(1).set([2, 1, 0.5, 0, -0.5])
    const original = [...buffer.getChannelData(0)]
    const data = encodeWav(buffer)
    const view = new DataView(data)
    const tag = (offset) => String.fromCharCode(...new Uint8Array(data, offset, 4))
    assert.equal(data.byteLength, 64)
    assert.equal(tag(0), "RIFF")
    assert.equal(view.getUint32(4, true), 56)
    assert.equal(tag(8), "WAVE")
    assert.equal(tag(12), "fmt ")
    assert.equal(view.getUint32(16, true), 16)
    assert.equal(view.getUint16(20, true), 1)
    assert.equal(view.getUint16(22, true), 2)
    assert.equal(view.getUint32(24, true), 44100)
    assert.equal(view.getUint32(28, true), 176400)
    assert.equal(view.getUint16(32, true), 4)
    assert.equal(view.getUint16(34, true), 16)
    assert.equal(tag(36), "data")
    assert.equal(view.getUint32(40, true), 20)
    assert.deepEqual(
        Array.from({ length: 10 }, (_, i) => view.getInt16(44 + i * 2, true)),
        [-32768, 32767, -32768, 32767, -16384, 16384, 0, 0, 16384, -16384],
    )
    assert.deepEqual([...buffer.getChannelData(0)], original)
})

test("WAV rejects unsupported formats and non-finite samples in either channel", () => {
    for (const [channels, rate] of [
        [1, 44100],
        [3, 44100],
        [2, 48000],
    ]) {
        assert.throws(() => encodeWav(audioBuffer(channels, 1, rate)), /stereo audio at 44100 Hz/)
    }
    for (const value of [NaN, Infinity, -Infinity]) {
        for (let channel = 0; channel < 2; channel++) {
            const buffer = audioBuffer(2, 2, 44100)
            buffer.getChannelData(channel)[1] = value
            assert.throws(() => encodeWav(buffer), /non-finite audio/)
        }
    }
})

test("loop render folds a release into the first frames without adding to the period", () => {
    const rendered = audioBuffer(2, 6, 44100)
    rendered.getChannelData(0).set([0.25, 0.5, -0.5, 0, 0.25, -0.25])
    rendered.getChannelData(1).set([-0.25, -0.5, 0.5, 0, -0.25, 0.25])
    const loop = loopBuffer({ createBuffer: audioBuffer }, rendered, 4)
    assert.equal(loop.length, 4)
    assert.deepEqual([...loop.getChannelData(0)], [0.5, 0.25, -0.5, 0])
    assert.deepEqual([...loop.getChannelData(1)], [-0.5, -0.25, 0.5, 0])
})

test("Iron Circuit is the configured song and renders a 16-bar WAV without clipping or a large seam", () => {
    const config = JSON.parse(readFileSync(new URL("../gams.json", import.meta.url), "utf8"))
    const layout = config.ui.services["ui-layout"].config.layout
    assert.equal(layout, '<view-synth data-source="examples/iron-circuit.json" />')
    const song = JSON.parse(readFileSync(new URL("../examples/iron-circuit.json", import.meta.url), "utf8"))
    const data = renderSongData(song)
    assert.equal(data[1].length, 7)
    assert.ok(data[1].every((track) => track[1].length === 8))
    const frames = 3759 * 32 * 8
    const loop = loopBuffer({ createBuffer: audioBuffer }, engine().song(data), frames)
    assertAudibleFinite(loop)
    for (let channel = 0; channel < 2; channel++) {
        const samples = loop.getChannelData(channel)
        assert.ok(samples.every((sample) => Math.abs(sample) < 1), "mix has headroom")
        assert.ok(Math.abs(samples[0] - samples.at(-1)) < 0.005, "quiet wrap boundary")
    }
    const wav = new DataView(encodeWav(loop))
    assert.equal(wav.getUint32(40, true), 4 * frames)
})
