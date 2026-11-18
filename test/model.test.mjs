import assert from "node:assert/strict"
import test from "node:test"
import {
    createSong,
    FIELDS,
    normalizeInstrument,
    normalizeSong,
    noteName,
    PRESETS,
    parseNote,
    parseSequence,
    renderLength,
    renderSongData,
} from "../src/model.mjs"

const songWith = (instrument = PRESETS.Default, sequence = [1], patterns = [[147]]) => [
    1000,
    [[instrument, sequence, patterns]],
]

test("new songs have independent tracks, instruments and note rows", () => {
    const song = createSong()
    assert.equal(song[0], 5513)
    assert.equal(song[1].length, 8)
    for (const [instrument, sequence, patterns] of song[1]) {
        assert.equal(instrument.length, 30)
        assert.deepEqual(sequence, [1])
        assert.equal(patterns.length, 9)
        for (const pattern of patterns) assert.deepEqual(pattern, Array(32).fill(0))
    }
    song[1][0][0][0] = 0
    song[1][0][2][0][0] = 147
    assert.equal(song[1][1][0][0], PRESETS.Default[0])
    assert.equal(song[1][0][2][1][0], 0)
    assert.equal(song[1][1][2][0][0], 0)
    assert.equal(createSong()[1][0][2][0][0], 0)
})

test("compact JSON null entries and holes normalize to dense zero-filled arrays without mutation", () => {
    const input = [
        1000,
        [
            [
                [7, null],
                [1, null, 0],
                [[147, null], null],
            ],
        ],
    ]
    const before = structuredClone(input)
    const normalized = normalizeSong(input)
    assert.deepEqual(input, before)
    assert.deepEqual(normalized[1][0][0], [7, ...Array(29).fill(0)])
    assert.deepEqual(normalized[1][0][1], [1, 0, 0])
    assert.deepEqual(normalized[1][0][2][0], [147, ...Array(31).fill(0)])
    assert.deepEqual(normalized[1][0][2][1], Array(32).fill(0))
    for (const track of normalized[1].slice(1)) assert.deepEqual(track[1], [])
    assert.deepEqual(normalizeSong(songWith([], Array(2), [Array(2)]))[1][0][1], [0, 0])
    normalized[1][0][2][0][0] = 1
    assert.equal(input[1][0][2][0][0], 147)
})

test("instrument fields enforce every documented integer range", () => {
    assert.equal(FIELDS.length, 30)
    assert.deepEqual(normalizeInstrument([]), Array(30).fill(0))
    assert.deepEqual(
        normalizeInstrument(FIELDS.map((field) => field[2])),
        FIELDS.map((field) => field[2]),
    )
    for (const [index, field] of FIELDS.entries()) {
        for (const bad of [-1, field[2] + 1, 0.5, NaN, Infinity, "1", true, {}]) {
            const instrument = Array(30).fill(0)
            instrument[index] = bad
            assert.throws(() => normalizeInstrument(instrument), /must be an integer/, `field ${index}: ${String(bad)}`)
        }
    }
    for (const bad of [null, {}, "instrument", Array(31)]) assert.throws(() => normalizeInstrument(bad))
})

test("song normalization rejects malformed shapes and values", () => {
    const invalid = [
        null,
        {},
        [],
        [1000],
        [1000, [], 0],
        [999, [[[], [], []]]],
        [16539, [[[], [], []]]],
        [1000.5, [[[], [], []]]],
        ["1000", [[[], [], []]]],
        [1000, []],
        [1000, Array(9).fill([[], [], []])],
        [1000, null],
        [1000, [null]],
        [1000, [[[], []]]],
        [1000, [[[], [], [], 0]]],
        songWith([], null),
        songWith([], Array(65).fill(0)),
        songWith([], [10]),
        songWith([], [-1]),
        songWith([], [1.5]),
        songWith([], ["1"]),
        songWith([], [], null),
        songWith([], [], Array(10).fill([])),
        songWith([], [], ["bad"]),
        songWith([], [], [Array(33).fill(0)]),
        songWith([], [], [[-1]]),
        songWith([], [], [[256]]),
        songWith([], [], [[1.5]]),
        songWith([], [], [["147"]]),
    ]
    for (const input of invalid) assert.throws(() => normalizeSong(input), JSON.stringify(input))
    assert.equal(normalizeSong([16538, [[[], [], []]]])[0], 16538)
    assert.equal(normalizeSong(songWith([], [9], [[255]]))[1][0][2][0][0], 255)
})

test("note names round-trip the entire supported byte range", () => {
    for (let note = 0; note <= 255; note++) assert.equal(parseNote(noteName(note)), note)
    for (const [text, note] of [
        [" c5 ", 147],
        ["F#-4", 141],
        ["B9", 206],
        ["C0", 87],
        ["---", 0],
        ["", 0],
        ["255", 255],
    ]) {
        assert.equal(parseNote(text), note)
    }
    for (const text of ["256", "-1", "1.5", "C10", "H4", "E#4", "Db4", "C", "C#-10"])
        assert.throws(() => parseNote(text))
    for (const note of [-1, 256, NaN, 1.5, "147"]) assert.throws(() => noteName(note))
})

test("sequence parser accepts silence, whitespace and commas with a 64-step maximum", () => {
    assert.deepEqual(parseSequence(" \n\t"), [])
    assert.deepEqual(parseSequence(" 1, 0\n9\t2 "), [1, 0, 9, 2])
    assert.equal(parseSequence(Array(64).fill("9").join(" ")).length, 64)
    for (const text of ["10", "-1", "1.0", "a", "1;2", "1,", ",1", Array(65).fill("1").join(" ")]) {
        assert.throws(() => parseSequence(text))
    }
})

test("render length includes the longest sequence, envelope and decaying delay tail", () => {
    const instrument = normalizeInstrument(PRESETS.Default)
    instrument[20] = 3
    instrument[21] = 128
    const repeats = Math.ceil(Math.log(0.1) / Math.log(128 / 255))
    const expected = 2 * 1001 * 32 + 22200 + repeats * ((3 * 1001) >> 1)
    const song = [
        1001,
        [
            [instrument, [1, 0], [[147]]],
            [PRESETS.Default, [1], [[159]]],
        ],
    ]
    assert.equal(renderLength(song), expected)
    assert.equal(renderLength(songWith(PRESETS.Default)), 32000 + 22200)
    assert.equal(renderLength(songWith([], [])), 1)
})

test("render guards reject active zero envelopes, dangerous delay and excessive duration", () => {
    assert.throws(() => renderLength(songWith([])), /cannot all be zero/)
    const instrument = normalizeInstrument(PRESETS.Default)
    instrument[20] = 16
    instrument[21] = 248
    assert.throws(() => renderLength([16538, [[instrument, [1], [[147]]]]]), /120 seconds/)
    instrument[21] = 255
    assert.throws(() => renderLength(songWith(instrument)), /integer/)
    assert.throws(() => renderLength([16538, [[PRESETS.Default, Array(64).fill(1), [[147]]]]]), /120 seconds/)
    const boundary = normalizeInstrument(PRESETS.Default)
    boundary[13] = 4000
    boundary[14] = 0
    boundary[15] = 0
    const song = [16525, [[boundary, Array(10).fill(1), [[147]]]]]
    assert.equal(renderLength(song), 44100 * 120)
    boundary[13]++
    assert.throws(() => renderLength(song), /120 seconds/)
})

test("render data excludes inactive tracks, preserves silent steps and does not mutate source", () => {
    const input = [
        1000,
        [
            [[], [], []],
            [PRESETS.Default, [0, 1], [[147]]],
        ],
    ]
    const before = structuredClone(input)
    const rendered = renderSongData(input)
    assert.equal(rendered[1].length, 1)
    assert.deepEqual(rendered[1][0][1], [0, 1])
    assert.deepEqual(input, before)
    assert.throws(() => renderSongData(songWith([], [])), /no sequence steps/)
})

test("render guards bound overlapping-note CPU work independently of song duration", () => {
    const song = createSong()
    for (const track of song[1]) {
        track[0][13] = track[0][14] = track[0][15] = 200000
        track[2][0].fill(147)
    }
    assert.throws(() => renderLength(song), /50 million note samples/)
})
