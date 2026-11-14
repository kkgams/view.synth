// Instrument ordering and presets adapted from PL_SYNTH tracker.html; see NOTICE.
const WAVES = ['Sine', 'Square', 'Saw', 'Triangle']
export const FIELDS = [
    ['Oscillator 1', 'Octave', 16], ['Oscillator 1', 'Semitone', 11],
    ['Oscillator 1', 'Detune', 255], ['Oscillator 1', 'Pitch envelope', 1],
    ['Oscillator 1', 'Volume', 255], ['Oscillator 1', 'Waveform', 3, WAVES],
    ['Oscillator 2', 'Octave', 16], ['Oscillator 2', 'Semitone', 11],
    ['Oscillator 2', 'Detune', 255], ['Oscillator 2', 'Pitch envelope', 1],
    ['Oscillator 2', 'Volume', 255], ['Oscillator 2', 'Waveform', 3, WAVES],
    ['Envelope', 'Noise', 255], ['Envelope', 'Attack (samples)', 200000],
    ['Envelope', 'Sustain (samples)', 200000], ['Envelope', 'Release (samples)', 200000],
    ['Envelope', 'Master', 255],
    ['Effects', 'Filter', 4, ['Off', 'High pass', 'Low pass', 'Band pass', 'Notch']],
    ['Effects', 'Frequency (Hz)', 11025], ['Effects', 'Resonance', 255],
    ['Effects', 'Delay time (half rows)', 16], ['Effects', 'Delay amount', 248],
    ['Effects', 'Pan frequency', 16], ['Effects', 'Pan amount', 255],
    ['LFO', 'Oscillator 1 frequency', 1], ['LFO', 'Filter frequency', 1],
    ['LFO', 'Frequency', 16], ['LFO', 'Amount', 255], ['LFO', 'Waveform', 3, WAVES],
]
export const PRESETS = {
    Default: [7,0,0,0,192,0,7,0,0,0,192,0,0,200,2000,20000,192],
    'Classic 8-bit': [7,0,0,0,192,1,6,0,9,0,192,1,0,137,2000,4611,192,1,982,89,6,25,6,77,0,1,3,69],
    Bell: [9,0,0,0,255,0,9,0,12,0,255,0,0,100,0,14545,70,0,0,240,2,157,3,47],
    'Bass drum': [7,0,0,1,255,0,7,0,0,1,255,0,0,50,150,4800,200,2,600,254],
    Snare: [8,0,0,1,160,0,8,0,0,1,160,0,210,50,200,6800,160,4,11025,254,6,32,5,61,0,1,4,60],
    Hihat: [8,0,0,1,82,2,8,0,0,0,0,0,255,100,0,9090,232,3,5200,63],
}

function integer(value, min, max, name) {
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new Error(`${name} must be an integer from ${min} to ${max}`)
    }
    return value
}

export function normalizeInstrument(data) {
    if (!Array.isArray(data) || data.length > 29) throw new Error('Expected an instrument array of up to 29 values')
    return FIELDS.map(([group, name, max], i) => integer(data[i] ?? 0, 0, max, `${group}: ${name}`))
}

export function createSong() {
    return [5513, Array.from({length: 8}, () => [normalizeInstrument(PRESETS.Default), [1], Array.from({length: 9}, () => Array(32).fill(0))])]
}

export function normalizeSong(data) {
    if (!Array.isArray(data) || data.length !== 2) throw new Error('Expected [row length, tracks]')
    const rowLength = integer(data[0], 1000, 16538, 'Row length')
    if (!Array.isArray(data[1]) || data[1].length < 1 || data[1].length > 8) throw new Error('Expected 1–8 tracks')
    const song = createSong()
    song[0] = rowLength
    // Unused tracks must not add sequence time to imported songs.
    for (const track of song[1]) track[1] = []
    data[1].forEach((track, index) => {
        if (!Array.isArray(track) || track.length !== 3) throw new Error(`Track ${index + 1}: expected [instrument, sequence, patterns]`)
        const [instrument, sequence, patterns] = track
        if (!Array.isArray(sequence) || sequence.length > 64) throw new Error('Sequence must contain at most 64 pattern numbers')
        if (!Array.isArray(patterns) || patterns.length > 9) throw new Error('Expected at most 9 patterns per track')
        song[1][index] = [normalizeInstrument(instrument),
            Array.from(sequence, value => integer(value ?? 0, 0, 9, 'Pattern number')),
            Array.from({length: 9}, (_, i) => {
                const pattern = patterns[i] ?? []
                if (!Array.isArray(pattern) || pattern.length > 32) throw new Error('Each pattern must have at most 32 notes')
                return Array.from({length: 32}, (_, row) => integer(pattern[row] ?? 0, 0, 255, 'Note'))
            })]
    })
    return song
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export function noteName(note) {
    integer(note, 0, 255, 'Note')
    if (!note) return ''
    if (note < 87 || note > 206) return String(note)
    return NOTE_NAMES[(note - 87) % 12] + Math.floor((note - 87) / 12)
}

export function parseNote(text) {
    const value = text.trim().toUpperCase()
    if (!value || value === '---') return 0
    if (/^\d+$/.test(value)) return integer(Number(value), 0, 255, 'Note')
    const match = /^([A-G]#?)-?([0-9])$/.exec(value)
    if (!match || !NOTE_NAMES.includes(match[1])) throw new Error('Use a note such as C5, F#4, a number 1–255, or leave empty')
    return 87 + Number(match[2]) * 12 + NOTE_NAMES.indexOf(match[1])
}

export function parseSequence(text) {
    if (!text.trim()) return []
    const parts = text.trim().split(/[\s,]+/)
    if (parts.length > 64 || parts.some(part => !/^[0-9]$/.test(part))) throw new Error('Use up to 64 pattern numbers (0–9), separated by spaces; 0 is silence')
    return parts.map(Number)
}

export function renderLength(song) {
    const [rowLength, tracks] = normalizeSong(song)
    let length = 1
    let work = 0
    for (const [instrument, sequence, patterns] of tracks) {
        if (!sequence.length) continue
        const envelope = instrument[13] + instrument[14] + instrument[15]
        if (!envelope) throw new Error('Attack, sustain and release cannot all be zero for an active track')
        for (const index of sequence) {
            if (index) work += patterns[index - 1].filter(Boolean).length * envelope
        }
        if (work > 50000000) throw new Error('Rendering exceeds 50 million note samples; shorten envelopes or reduce notes')
        const delay = instrument[21] / 255
        const repeats = delay ? Math.ceil(Math.log(0.1) / Math.log(delay)) : 0
        length = Math.max(length, sequence.length * rowLength * 32 + envelope + repeats * ((instrument[20] * rowLength) >> 1))
    }
    if (length > 44100 * 120) throw new Error('Rendering is limited to 120 seconds; shorten the sequence or reduce delay')
    return length
}

export function renderSongData(song) {
    renderLength(song)
    const normalized = normalizeSong(song)
    normalized[1] = normalized[1].filter(track => track[1].length)
    if (!normalized[1].length) throw new Error('The song has no sequence steps')
    return normalized
}

export function encodeWav(buffer) {
    const channels = buffer.numberOfChannels
    if (channels !== 2 || buffer.sampleRate !== 44100) throw new Error('Expected stereo audio at 44100 Hz')
    const data = new ArrayBuffer(44 + buffer.length * channels * 2)
    const view = new DataView(data)
    const tag = (offset, text) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)))
    tag(0, 'RIFF'); view.setUint32(4, data.byteLength - 8, true); tag(8, 'WAVE')
    tag(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true)
    view.setUint16(22, channels, true); view.setUint32(24, 44100, true)
    view.setUint32(28, 44100 * channels * 2, true); view.setUint16(32, channels * 2, true)
    view.setUint16(34, 16, true); tag(36, 'data'); view.setUint32(40, data.byteLength - 44, true)
    const samples = [buffer.getChannelData(0), buffer.getChannelData(1)]
    for (let i = 0; i < buffer.length; i++) {
        for (let c = 0; c < channels; c++) {
            const value = samples[c][i]
            if (!Number.isFinite(value)) throw new Error('Synth produced non-finite audio; adjust the instrument')
            const clipped = Math.max(-1, Math.min(1, value))
            view.setInt16(44 + (i * channels + c) * 2, Math.round(clipped * (clipped < 0 ? 32768 : 32767)), true)
        }
    }
    return data
}
