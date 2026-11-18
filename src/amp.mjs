import { GUITAR_AMP, loopBuffer, renderLength, renderSongData } from "./model.mjs"

// Tight rhythm and warmer lead voicings. Only guitar tracks go through the amp.
const GUITAR_AMPS = [null, { gain: 20, bassCut: 105, speakerCut: 3500 }, { gain: 12, bassCut: 160, speakerCut: 2800 }]

function ampSamples(samples, rate, { gain, bassCut, speakerCut }, loop) {
    const coefficient = (hz) => 1 - Math.exp((-2 * Math.PI * hz) / rate)
    const bass = coefficient(bassCut)
    const dc = coefficient(75)
    const speaker = coefficient(speakerCut)
    let low = 0
    let bias = 0
    let cone = 0
    let cabinet = 0
    // Prime filter state with the end of the same loop instead of starting it cold at the seam.
    const warmup = loop ? Math.min(samples.length, 1536) : 0
    for (let i = -warmup; i < samples.length; i++) {
        const input = samples[i < 0 ? samples.length + i : i]
        low += bass * (input - low)
        const driven = gain * (input - low)
        const clipped = driven / (1 + Math.abs(driven))
        bias += dc * (clipped - bias)
        cone += speaker * (clipped - bias - cone)
        cabinet += speaker * (cone - cabinet)
        if (i >= 0) samples[i] = 0.27 * (cabinet + 0.22 * (cone - cabinet))
    }
}

function applyGuitarAmp(buffer, amp, loop = false) {
    if (amp) {
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            ampSamples(buffer.getChannelData(channel), buffer.sampleRate, amp, loop)
        }
    }
    return buffer
}

export function renderNote(synth, instrument, note, rowLength) {
    return applyGuitarAmp(synth.sound(instrument.slice(0, GUITAR_AMP), note, rowLength), GUITAR_AMPS[instrument[GUITAR_AMP]])
}

export function renderArrangement(synth, audio, song, loop = false) {
    const [rowLength, tracks] = renderSongData(song)
    const period = rowLength * 32 * Math.max(...tracks.map((track) => track[1].length))
    const dry = []
    const guitars = []
    for (const [instrument, sequence, patterns] of tracks) {
        const track = [instrument.slice(0, GUITAR_AMP), sequence, patterns]
        const amp = GUITAR_AMPS[instrument[GUITAR_AMP]]
        if (amp) guitars.push([track, amp])
        else dry.push(track)
    }
    const render = (group) => {
        const buffer = synth.song([rowLength, group])
        // A short guitar sequence still needs to occupy its place in the full arrangement.
        return loop ? loopBuffer(audio, buffer, period) : buffer
    }
    if (!guitars.length) return render(dry)
    if (guitars.length === 1 && !dry.length) {
        const [[track, amp]] = guitars
        return applyGuitarAmp(render([track]), amp, loop)
    }
    const mix = audio.createBuffer(2, loop ? period : renderLength(song), 44100)
    const add = (stem) => {
        for (let channel = 0; channel < mix.numberOfChannels; channel++) {
            const sum = mix.getChannelData(channel)
            const samples = stem.getChannelData(channel)
            for (let i = 0; i < samples.length; i++) sum[i] += samples[i]
        }
    }
    if (dry.length) add(render(dry))
    for (const [track, amp] of guitars) add(applyGuitarAmp(render([track]), amp, loop))
    return mix
}
