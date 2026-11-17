import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import * as model from "../src/model.mjs"

// Exercise View rendering and interactions without mounting a Host or generating audio.
const frames = new Map()
let nextFrame = 0
const source = readFileSync(new URL("../src/views/view-synth.js", import.meta.url), "utf8")
const ViewSynth = runInNewContext(
    source
        .replace(/^import .*\n/, "")
        .replace("export class ViewSynth", "class ViewSynth")
        .replace(/customElements\.define\(["']view-synth["'], ViewSynth\)/, "ViewSynth"),
    {
        HTMLElement: class {},
        HTMLInputElement: class {},
        HTMLTextAreaElement: class {},
        Event,
        ...model,
        requestAnimationFrame(callback) {
            frames.set(++nextFrame, callback)
            return nextFrame
        },
        cancelAnimationFrame(id) {
            frames.delete(id)
        },
    },
)

function transport() {
    const icon = { textContent: "" }
    const attributes = {}
    const button = {
        setAttribute: (name, value) => {
            attributes[name] = value
        },
        querySelector: () => icon,
    }
    const view = Object.create(ViewSynth.prototype)
    Object.assign(view, {
        header: { querySelector: () => button },
        source: null,
        playback: null,
        playbackFrame: null,
        paused: false,
        playMode: "song",
        isConnected: true,
        status(text) {
            this.statusText = text
        },
        updateSelection() {},
    })
    return { view, icon, attributes }
}

function editor() {
    const { view } = transport()
    const controls = new Map()
    view.song = model.createSong()
    view.track = 0
    view.pattern = 0
    view.row = 0
    view.rowAnchor = 0
    view.step = 0
    view.pianoOctave = 4
    view.pianoFocus = 0
    view.previewNote = null
    view.control = (selector) => {
        if (!controls.has(selector)) controls.set(selector, { innerHTML: "", value: "", reportValidity: () => true })
        return controls.get(selector)
    }
    view.querySelectorAll = () => []
    view.updateSelection = ViewSynth.prototype.updateSelection
    const headerControl = view.header.querySelector
    view.header.querySelector = (selector) =>
        selector === '[data-field="bpm"]' ? { reportValidity: () => true } : headerControl(selector)
    return view
}

test("workspace sections use spanning table headers without redundant fieldsets", () => {
    const view = editor()
    view.unmountHeader = () => {}
    view.parentElement = { append() {} }
    const header = view.control('[slot="header-controls"]')
    header.addEventListener = () => {}
    header.querySelector = (selector) => view.control(selector)
    view.updateTransport = () => {}
    view.renderEditor = () => {}
    view.render()
    const heading = /<thead>([\s\S]*?)<\/thead>/.exec(view.innerHTML)[1]
    assert.match(heading, /<th scope="col">Sequencer<\/th><td><div role="buttongroup">/)
    const actions = /<td>([\s\S]*?)<\/td>/.exec(heading)[1]
    for (const action of ["add-step", "remove-step"]) {
        assert.ok(actions.includes(`data-action="${action}"`))
        assert.equal(view.innerHTML.split(`data-action="${action}"`).length - 1, 1)
    }
    assert.match(view.innerHTML, /<th colspan="8" scope="col" data-element="track-name"><\/th>/)
    assert.match(view.innerHTML, /colspan="2" rowspan="3"/)
    assert.match(view.innerHTML, /<tr><td colspan="8"><svg data-element="piano"/)
    assert.doesNotMatch(view.innerHTML, /<fieldset|<legend|data-field="(?:track|pattern)"|data-action="(?:row|clear)"/)
})

test("all nine 32-row patterns render together with distinct note addresses", () => {
    const view = editor()
    view.song[1][0][2][8][31] = 147
    view.renderPatterns()
    const html = view.control('[data-element="patterns"]').innerHTML
    assert.doesNotMatch(html, /<input|<button|<caption|contenteditable/)
    assert.equal((html.match(/<th colspan="2" scope="col" role="button"/g) || []).length, 9)
    assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1)
    assert.equal((html.match(/<tr data-pattern=/g) || []).length, 9 * 32)
    assert.equal((html.match(/<table /g) || []).length, 9)
    assert.match(html, /data-pattern="8" data-row="31"[^>]*aria-label="Pattern 9, row 32: C5"/)
    assert.match(html, /<td>C5<\/td>/)
    assert.equal((html.match(/aria-selected="true"/g) || []).length, 1)
    assert.equal((html.match(/tabindex="0"/g) || []).length, 2) // Pattern header and note row.
})

test("sequencer renders eight track columns and preserves blank inactive tails", () => {
    const view = editor()
    view.song[1][1][1] = [1, 0, 9]
    view.song[1][0][1] = []
    view.renderSequence()
    const html = view.control('[data-element="sequencer"]').innerHTML
    assert.doesNotMatch(html, /<input|contenteditable/)
    assert.equal((html.match(/<td data-sequence-track=/g) || []).length, 8 * 3)
    assert.match(html, /data-sequence-track="0"><\/td>/)
    assert.match(html, /data-sequence-track="1">0<\/td>/)
    assert.equal((html.match(/<col data-track=/g) || []).length, 8)
    assert.equal((html.match(/<th scope="col" role="button"/g) || []).length, 8)
    assert.equal((html.match(/aria-selected="true"/g) || []).length, 2) // Column and step.
    assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1) // Track header.
    assert.equal((html.match(/tabindex="0"/g) || []).length, 2) // Header and row groups.
    assert.deepEqual(view.song[1][0][1], [])
})

test("instrument panels render every parameter once", () => {
    const view = editor()
    view.renderInstrument()
    const html = view.control('[data-element="instrument"]').innerHTML
    const indices = [...html.matchAll(/data-instrument="(\d+)"/g)]
        .map((match) => Number(match[1]))
        .sort((a, b) => a - b)
    assert.deepEqual(
        indices,
        Array.from({ length: 29 }, (_, i) => i),
    )
    for (const title of ["OSC 1", "OSC 2", "ENV", "FX", "LFO", "Preset"])
        assert.ok(html.includes(`<th colspan="2" scope="col">${title}</th>`))
    assert.doesNotMatch(html, /fieldset|legend|role="button"/)
    assert.match(html, /aria-label="Instrument preset"/)
    assert.match(html, /data-field="preset"/)
    assert.doesNotMatch(html, /data-field="preview"|data-action="note"|Preset and preview/)
})

test("numeric instrument fields render bounded integer sliders while other control types stay unchanged", () => {
    const view = editor()
    view.renderInstrument()
    const html = view.control('[data-element="instrument"]').innerHTML
    const sliders = [...html.matchAll(/<input type="range" ([^>]+)>/g)]
    const expected = model.FIELDS.map(([, , max, options], index) => (!options && max !== 1 ? index : null)).filter(
        (index) => index !== null,
    )
    assert.deepEqual(
        sliders.map(([, attributes]) => Number(/data-instrument="(\d+)"/.exec(attributes)[1])).sort((a, b) => a - b),
        expected,
    )
    for (const [, attributes] of sliders) {
        const index = Number(/data-instrument="(\d+)"/.exec(attributes)[1])
        assert.ok(
            attributes.includes(
                `value="${view.song[1][0][0][index]}" min="0" max="${model.FIELDS[index][2]}" step="1"`,
            ),
        )
        assert.doesNotMatch(attributes, /required|autocomplete|autocorrect|autocapitalize|spellcheck/)
    }
    assert.doesNotMatch(html, /type="number"/)
    assert.equal((html.match(/type="checkbox"/g) || []).length, 4)
    assert.equal((html.match(/<select data-instrument=/g) || []).length, 4)
})

test("instrument slider changes update the selected track and retain strict value validation", () => {
    const view = editor()
    view.track = 2
    const expected = structuredClone(view.song)
    expected[1][2][0][2] = 123
    const input = {
        type: "range",
        dataset: { instrument: "2" },
        value: "123",
        matches: (selector) => selector === "[data-instrument]",
    }
    view.change(input)
    assert.equal(JSON.stringify(view.song), JSON.stringify(expected))
    input.value = "256"
    assert.throws(() => view.change(input), /integer from 0 to 255/)
    assert.equal(JSON.stringify(view.song), JSON.stringify(expected))
})

test("SVG piano renders three octaves with white keys behind black keys and one roving key", () => {
    const view = editor()
    view.renderPiano()
    const html = view.control('[data-element="piano"]').innerHTML
    const notes = [...html.matchAll(/data-note="(\d+)"/g)].map((match) => Number(match[1])).sort((a, b) => a - b)
    assert.deepEqual(
        notes,
        Array.from({ length: 36 }, (_, i) => model.parseNote("C4") + i),
    )
    assert.equal((html.match(/fill="#eee" stroke=/g) || []).length, 21)
    assert.equal((html.match(/fill="#222" stroke=/g) || []).length, 15)
    assert.equal((html.match(/tabindex="0"/g) || []).length, 3) // Two octave controls and one piano key.
    assert.ok(html.lastIndexOf('fill="#eee" stroke=') < html.indexOf('fill="#222" stroke='))
    assert.match(html, /aria-label="Write C4 and preview"/)
    assert.match(html, /aria-label="Write B6 and preview"/)
    assert.doesNotMatch(html, /style=|<style|onclick=/)
})

test("piano octave changes are bounded and retain focus without changing song or row selection", async () => {
    const view = editor()
    const before = JSON.stringify(view.song)
    let focus = ""
    const control = view.control
    view.control = (selector) =>
        selector.startsWith("g[")
            ? {
                  focus() {
                      focus = selector
                  },
              }
            : control(selector)
    const button = (offset) => ({ dataset: { offset: String(offset) }, getAttribute: () => null })
    view.pianoOctave = 6
    await view.action("piano-octave", button(1))
    assert.equal(view.pianoOctave, 7)
    assert.match(focus, /data-offset="-1"/)
    assert.match(
        view.control('[data-element="piano"]').innerHTML,
        /data-offset="1" tabindex="-1"[^>]*aria-disabled="true"/,
    )
    await assert.rejects(view.action("piano-octave", button(1)), /Invalid piano octave/)
    view.pianoOctave = 1
    await view.action("piano-octave", button(-1))
    assert.equal(view.pianoOctave, 0)
    assert.match(focus, /data-offset="1"/)
    await view.action("piano-octave", { getAttribute: () => "true" })
    assert.equal(view.pianoOctave, 0)
    assert.equal(view.row, 0)
    assert.equal(JSON.stringify(view.song), before)
})

test("piano keys write and preview their exact pitch on only the selected track and row", async () => {
    const view = editor()
    view.track = 3
    const expected = structuredClone(view.song)
    expected[1][3][2][0][0] = model.parseNote("F#5")
    const played = []
    let focused = false
    view.play = async (mode, note) => played.push([mode, note, view.track])
    await view.action("piano-note", {
        dataset: { note: String(model.parseNote("F#5")) },
        focus() {
            focused = true
        },
    })
    assert.deepEqual(played, [["note", model.parseNote("F#5"), 3]])
    assert.equal(view.pianoFocus, 18)
    assert.ok(focused)
    assert.equal(JSON.stringify(view.song), JSON.stringify(expected))
    assert.match(view.control('[data-element="patterns"]').innerHTML, /Pattern 1, row 1: F#5/)
    await assert.rejects(view.action("piano-note", { dataset: { note: "NaN" } }), /Invalid piano key/)
    assert.equal(JSON.stringify(view.song), JSON.stringify(expected))
})

test("piano entry fills inclusive forward or reverse ranges without advancing or touching neighbors", async () => {
    for (const [anchor, row] of [
        [2, 4],
        [4, 2],
        [31, 31],
        [0, 31],
    ]) {
        const view = editor()
        view.track = 2
        view.pattern = 8
        view.rowAnchor = anchor
        view.row = row
        const note = model.parseNote("C4")
        const expected = structuredClone(view.song)
        expected[1][2][2][8].fill(note, Math.min(anchor, row), Math.max(anchor, row) + 1)
        view.play = async () => {}
        await view.action("piano-note", { dataset: { note: String(note) }, focus() {} })
        assert.equal(JSON.stringify(view.song), JSON.stringify(expected))
        assert.equal(view.rowAnchor, anchor)
        assert.equal(view.row, row)
        assert.equal(view.pattern, 8)
        const html = view.control('[data-element="patterns"]').innerHTML
        assert.equal((html.match(/aria-selected="true"/g) || []).length, Math.abs(anchor - row) + 1)
        assert.equal((html.match(/tabindex="0"/g) || []).length, 2)
    }
})

test("piano entry retains written notes if audio preview fails", async () => {
    const view = editor()
    view.play = async () => {
        throw new Error("Audio unavailable")
    }
    await assert.rejects(view.action("piano-note", { dataset: { note: "135" }, focus() {} }), /Audio unavailable/)
    assert.equal(view.song[1][0][2][0][0], 135)
})

test("removed selected-note preview and clear actions cannot play or modify patterns", async () => {
    const view = editor()
    view.song[1][0][2][0][0] = 135
    const before = JSON.stringify(view.song)
    view.play = async () => assert.fail("Removed actions must not play audio")
    for (const action of ["row", "clear"]) await assert.rejects(view.action(action), /Unknown synth action/)
    assert.equal(JSON.stringify(view.song), before)
})

test("piano key navigation is chromatic and clamps at both ends", () => {
    const view = editor()
    const focused = []
    view.control = (selector) => ({ focus: () => focused.push(selector) })
    const key = (index, key) =>
        view.navigatePiano({
            target: {
                closest: () => ({ dataset: { action: "piano-note", note: String(model.parseNote("C4") + index) } }),
            },
            key,
            preventDefault() {},
            stopPropagation() {},
        })
    key(0, "ArrowLeft")
    key(0, "ArrowRight")
    key(1, "End")
    key(35, "ArrowRight")
    key(35, "Home")
    assert.deepEqual(
        focused,
        [135, 136, 170, 170, 135].map((note) => `g[data-note="${note}"]`),
    )
})

test("piano Enter and Space activation share click actions and ignore auto-repeat", () => {
    const view = editor()
    const actions = []
    view.perform = (operation) => operation()
    view.action = (action, button) => actions.push([action, button.dataset.note])
    const button = { dataset: { action: "piano-note", note: "135" } }
    const event = (key, repeat = false) => ({
        target: { closest: () => button },
        key,
        repeat,
        preventDefault() {},
        stopPropagation() {},
    })
    view.navigatePiano(event("Enter"))
    view.navigatePiano(event(" "))
    view.navigatePiano(event("Enter", true))
    view.busy = true
    view.navigatePiano(event(" "))
    assert.deepEqual(actions, [
        ["piano-note", "135"],
        ["piano-note", "135"],
    ])
})

test("piano highlights follow audition playback, pause/resume and stop", async () => {
    const view = editor()
    const keys = [135, 136].map((note) => ({
        dataset: { note: String(note) },
        attributes: {},
        fill: null,
        setAttribute(name, value) {
            this.attributes[name] = value
        },
        querySelector() {
            return {
                setAttribute: (_name, value) => {
                    this.fill = value
                },
            }
        },
    }))
    view.querySelectorAll = (selector) => (selector === 'g[data-action="piano-note"]' ? keys : [])
    view.source = { stop() {}, disconnect() {} }
    view.previewNote = 136
    view.updateSelection()
    assert.deepEqual(
        keys.map((key) => key.attributes["aria-pressed"]),
        ["false", "true"],
    )
    assert.equal(keys[1].fill, "#b56b16")
    view.audio = { async suspend() {}, async resume() {} }
    await view.togglePlayback()
    assert.deepEqual(
        keys.map((key) => key.attributes["aria-pressed"]),
        ["false", "false"],
    )
    await view.togglePlayback()
    assert.deepEqual(
        keys.map((key) => key.attributes["aria-pressed"]),
        ["false", "true"],
    )
    view.stop()
    assert.deepEqual(
        keys.map((key) => key.attributes["aria-pressed"]),
        ["false", "false"],
    )
    assert.deepEqual(
        keys.map((key) => key.fill),
        ["#eee", "#222"],
    )
})

test("selecting a pattern row highlights just that row without changing song data", () => {
    const view = editor()
    const rows = [
        { dataset: { pattern: "0", row: "0" } },
        { dataset: { pattern: "8", row: "31" } },
        { dataset: { pattern: "8", row: "30" } },
    ].map((row) => ({
        ...row,
        attributes: {},
        focused: false,
        setAttribute(name, value) {
            this.attributes[name] = value
        },
        focus() {
            this.focused = true
        },
    }))
    view.querySelectorAll = (selector) => (selector === "tr[data-pattern][data-row]" ? rows : [])
    const before = JSON.stringify(view.song)
    view.selectPatternRow(rows[1], true)
    assert.equal(view.pattern, 8)
    assert.equal(view.row, 31)
    assert.deepEqual(
        rows.map((row) => row.attributes["aria-selected"]),
        ["false", "true", "false"],
    )
    assert.deepEqual(
        rows.map((row) => row.tabIndex),
        [-1, 0, -1],
    )
    assert.equal(rows[1].focused, true)
    assert.equal(JSON.stringify(view.song), before)
})

test("Shift row selection retains its anchor, supports reverse ranges and resets across patterns", () => {
    const view = editor()
    const before = JSON.stringify(view.song)
    const rows = [0, 1].flatMap((pattern) =>
        Array.from({ length: 32 }, (_, row) => ({
            dataset: { pattern: String(pattern), row: String(row) },
            attributes: {},
            setAttribute(name, value) {
                this.attributes[name] = value
            },
            focus() {},
        })),
    )
    view.querySelectorAll = (selector) => (selector === "tr[data-pattern][data-row]" ? rows : [])
    const selected = () =>
        rows
            .filter((row) => row.attributes["aria-selected"] === "true")
            .map((row) => [Number(row.dataset.pattern), Number(row.dataset.row)])
    view.selectPatternRow(rows[8])
    view.selectPatternRow(rows[3], true, true)
    assert.equal(view.rowAnchor, 8)
    assert.deepEqual(
        selected(),
        Array.from({ length: 6 }, (_, i) => [0, i + 3]),
    )
    view.selectPatternRow(rows[12], true, true)
    assert.equal(view.rowAnchor, 8)
    assert.deepEqual(
        selected(),
        Array.from({ length: 5 }, (_, i) => [0, i + 8]),
    )
    assert.equal(rows.filter((row) => row.tabIndex === 0).length, 1)
    assert.equal(rows[12].tabIndex, 0)
    view.selectPatternRow(rows[5])
    assert.deepEqual(selected(), [[0, 5]])
    view.selectPatternRow(rows[39], true, true)
    assert.equal(view.rowAnchor, 7)
    assert.deepEqual(selected(), [[1, 7]])
    assert.equal(JSON.stringify(view.song), before)
})

test("range rendering keeps one keyboard destination and resets when changing track or pattern", () => {
    const view = editor()
    view.rowAnchor = 3
    view.row = 8
    view.renderPatterns()
    const html = view.control('[data-element="patterns"]').innerHTML
    assert.equal((html.match(/aria-selected="true"/g) || []).length, 6)
    assert.equal((html.match(/tabindex="0"/g) || []).length, 2) // Header and range endpoint.
    view.setPattern(1)
    assert.equal(view.rowAnchor, 8)
    view.rowAnchor = 2
    view.selectTrack(1)
    assert.equal(view.rowAnchor, 8)
})

test("Shift keyboard navigation extends and shrinks a range; normal movement collapses it", () => {
    const view = editor()
    const rows = Array.from({ length: 32 }, (_, row) => ({
        dataset: { pattern: "0", row: String(row) },
        attributes: {},
        setAttribute(name, value) {
            this.attributes[name] = value
        },
        focus() {},
    }))
    view.querySelectorAll = (selector) => (selector === "tr[data-pattern][data-row]" ? rows : [])
    const control = view.control
    view.control = (selector) => {
        const match = /^tr\[data-pattern="0"\]\[data-row="(\d+)"\]$/.exec(selector)
        return match ? rows[Number(match[1])] : control(selector)
    }
    view.selectPatternRow(rows[2])
    const key = (key, shiftKey) =>
        view.navigateNotes({
            target: { closest: () => rows[view.row] },
            key,
            shiftKey,
            preventDefault() {},
            stopPropagation() {},
        })
    key("ArrowDown", true)
    key("ArrowDown", true)
    assert.equal(view.rowAnchor, 2)
    assert.equal(view.row, 4)
    key("ArrowUp", true)
    assert.equal(view.row, 3)
    key("Home", true)
    assert.equal(view.rowAnchor, 2)
    assert.equal(view.row, 0)
    assert.equal(rows.filter((row) => row.attributes["aria-selected"] === "true").length, 3)
    key("ArrowDown", false)
    assert.equal(view.rowAnchor, 1)
    assert.equal(view.row, 1)
    assert.equal(rows.filter((row) => row.attributes["aria-selected"] === "true").length, 1)
})

test("selecting a track mirrors column/header state without changing song or step selection", () => {
    const view = editor()
    const before = JSON.stringify(view.song)
    const elements = ["COL", "TH"].flatMap((tagName) =>
        Array.from({ length: 8 }, (_, track) => ({
            tagName,
            dataset: { track: String(track) },
            attributes: {},
            setAttribute(name, value) {
                this.attributes[name] = value
            },
        })),
    )
    view.querySelectorAll = (selector) => (selector === "col[data-track], th[data-track]" ? elements : [])
    view.selectTrack(4)
    for (const tag of ["COL", "TH"]) {
        const group = elements.filter((element) => element.tagName === tag)
        const attribute = tag === "TH" ? "aria-pressed" : "aria-selected"
        assert.deepEqual(
            group.map((element) => element.attributes[attribute]),
            ["false", "false", "false", "false", "true", "false", "false", "false"],
        )
        assert.ok(
            group.every((element) => element.attributes[tag === "TH" ? "aria-selected" : "aria-pressed"] === undefined),
        )
    }
    assert.deepEqual(
        elements.filter((element) => element.tagName === "TH").map((element) => element.tabIndex),
        [-1, -1, -1, -1, 0, -1, -1, -1],
    )
    assert.equal(view.step, 0)
    assert.equal(JSON.stringify(view.song), before)
})

test("track header keyboard selection supports activation, bounds and disabled columns", () => {
    const view = editor()
    const moves = []
    const headers = Array.from({ length: 8 }, (_, track) => ({
        dataset: { track: String(track) },
        getAttribute: (name) => (name === "aria-disabled" && track === 6 ? "true" : null),
        focus: () => moves.push(track),
    }))
    view.querySelectorAll = () => headers
    view.selectTrack = (track) => {
        view.track = track
    }
    const event = (track, key) => ({
        target: { closest: () => headers[track] },
        key,
        preventDefault() {},
        stopPropagation() {},
    })
    for (const key of ["Enter", " ", "ArrowRight", "ArrowLeft", "Home", "End"]) view.navigateHeaders(event(5, key))
    view.navigateHeaders(event(7, "ArrowRight"))
    view.navigateHeaders(event(0, "ArrowLeft"))
    view.navigateHeaders(event(6, "Enter"))
    assert.deepEqual(moves, [5, 5, 7, 4, 0, 7, 7, 0])
})

test("pattern header activation updates pressed state and preserves focus without changing data", () => {
    const view = editor()
    const before = JSON.stringify(view.song)
    const headers = Array.from({ length: 9 }, (_, pattern) => ({
        dataset: { action: "pattern", pattern: String(pattern) },
        attributes: {},
        focused: false,
        getAttribute(name) {
            return this.attributes[name] ?? null
        },
        setAttribute(name, value) {
            this.attributes[name] = value
        },
        focus() {
            this.focused = true
        },
    }))
    view.querySelectorAll = (selector) => (selector === 'th[data-action="pattern"]' ? headers : [])
    view.selectHeader(headers[4])
    assert.equal(view.pattern, 4)
    assert.equal(view.track, 0)
    assert.equal(headers[4].focused, true)
    assert.equal(headers.filter((header) => header.attributes["aria-pressed"] === "true").length, 1)
    assert.equal(headers[4].attributes["aria-pressed"], "true")
    assert.deepEqual(
        headers.map((header) => header.tabIndex),
        [-1, -1, -1, -1, 0, -1, -1, -1, -1],
    )
    headers[5].attributes["aria-disabled"] = "true"
    view.selectHeader(headers[5])
    assert.equal(view.pattern, 4)
    assert.equal(JSON.stringify(view.song), before)
})

test("pattern header keyboard navigation remains in its group and skips disabled patterns", () => {
    const view = editor()
    const moves = []
    const headers = Array.from({ length: 9 }, (_, pattern) => ({
        dataset: { action: "pattern", pattern: String(pattern) },
        getAttribute: (name) => (name === "aria-disabled" && pattern === 6 ? "true" : null),
        setAttribute() {},
        focus: () => moves.push(pattern),
    }))
    view.querySelectorAll = (selector) => (selector === 'th[data-action="pattern"]' ? headers : [])
    const event = (pattern, key) => ({
        target: { closest: () => headers[pattern] },
        key,
        preventDefault() {},
        stopPropagation() {},
    })
    for (const key of ["Enter", " ", "ArrowRight", "ArrowLeft", "Home", "End"]) view.navigateHeaders(event(5, key))
    view.navigateHeaders(event(8, "ArrowRight"))
    view.navigateHeaders(event(0, "ArrowLeft"))
    view.navigateHeaders(event(6, "Enter"))
    assert.deepEqual(moves, [5, 5, 7, 4, 0, 8, 8, 0])
    assert.equal(view.track, 0)
})

test("sequencer row selection highlights a single step without modifying song data", () => {
    const view = editor()
    view.song[1][0][1] = [1, 2]
    const rows = [0, 1].map((step) => ({
        dataset: { step: String(step) },
        attributes: {},
        focused: false,
        setAttribute(name, value) {
            this.attributes[name] = value
        },
        focus() {
            this.focused = true
        },
    }))
    view.querySelectorAll = (selector) => (selector === "tr[data-step]" ? rows : [])
    const before = JSON.stringify(view.song)
    view.selectSequenceRow(rows[1], 0, true)
    assert.equal(view.step, 1)
    assert.deepEqual(
        rows.map((row) => row.attributes["aria-selected"]),
        ["false", "true"],
    )
    assert.deepEqual(
        rows.map((row) => row.tabIndex),
        [-1, 0],
    )
    assert.equal(rows[1].focused, true)
    assert.equal(JSON.stringify(view.song), before)
})

test("selecting a sequencer row chooses the clicked track and its non-silent pattern", () => {
    const view = editor()
    view.song[1][2][1] = [9, 0]
    view.selectSequenceRow({ dataset: { step: "0" } }, 2)
    assert.equal(view.track, 2)
    assert.equal(view.pattern, 8)
    view.selectSequenceRow({ dataset: { step: "1" } }, 2)
    assert.equal(view.pattern, 8)
})

test("sequence add/remove retains notes, respects 64 steps and permits empty sequences", async () => {
    const view = editor()
    view.song[1][0][2][0][0] = 147
    await view.action("add-step")
    assert.equal(view.sequenceSteps(), 2)
    assert.deepEqual(Array.from(view.song[1][0][1]), [1, 0])
    view.step = 1
    await view.action("remove-step")
    assert.equal(view.step, 0)
    await view.action("remove-step")
    assert.ok(view.song[1].every((track) => !track[1].length))
    assert.equal(view.song[1][0][2][0][0], 147)
    view.song[1][0][1] = Array(64).fill(1)
    await assert.rejects(view.action("add-step"), /64 steps/)
    assert.equal(view.song[1][0][1].length, 64)
})

test("sequencer keyboard navigation clamps steps and tracks without changing data", () => {
    const view = editor()
    view.song[1][0][1] = [1, 2, 3]
    view.track = 7
    const moves = []
    view.control = (selector) => ({ selector })
    view.selectSequenceRow = (row, track) => moves.push([row.selector, track])
    const target = { closest: () => ({ dataset: { step: "2" } }) }
    const before = JSON.stringify(view.song)
    for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Enter"]) {
        view.navigateSequence({ target, key, preventDefault() {}, stopPropagation() {} })
    }
    assert.deepEqual(moves, [
        ['tr[data-step="1"]', 7],
        ['tr[data-step="2"]', 7],
        ['tr[data-step="2"]', 6],
        ['tr[data-step="2"]', 7],
        ['tr[data-step="0"]', 7],
        ['tr[data-step="2"]', 7],
        ['tr[data-step="2"]', 7],
    ])
    assert.equal(JSON.stringify(view.song), before)
})

test("keyboard row selection stays within bounds and supports pattern and endpoint navigation", () => {
    const view = editor()
    const moves = []
    const before = JSON.stringify(view.song)
    view.selectPatternRow = (row) => moves.push(row.selector)
    view.control = (selector) => ({ selector })
    const row = { dataset: { pattern: "8", row: "31" } }
    const target = { closest: () => row }
    for (const key of ["Enter", " ", "ArrowUp", "ArrowLeft", "ArrowRight", "ArrowDown", "Home", "End"]) {
        view.navigateNotes({ target, key, preventDefault() {}, stopPropagation() {} })
    }
    view.navigateNotes({ target, key: "Home", ctrlKey: true, preventDefault() {}, stopPropagation() {} })
    assert.deepEqual(moves, [
        'tr[data-pattern="8"][data-row="31"]',
        'tr[data-pattern="8"][data-row="31"]',
        'tr[data-pattern="8"][data-row="30"]',
        'tr[data-pattern="7"][data-row="31"]',
        'tr[data-pattern="8"][data-row="31"]',
        'tr[data-pattern="8"][data-row="31"]',
        'tr[data-pattern="8"][data-row="0"]',
        'tr[data-pattern="8"][data-row="31"]',
        'tr[data-pattern="0"][data-row="0"]',
    ])
    assert.equal(JSON.stringify(view.song), before)
})

function playingView(mode = "song") {
    const view = editor()
    view.song[0] = 11025 // Exactly one quarter second per row.
    view.song[1][0][1] = [2, 0, 3]
    view.audio = { currentTime: 100, async suspend() {}, async resume() {} }
    view.source = { stop() {}, disconnect() {} }
    view.playback = {
        mode,
        startedAt: 100,
        rowLength: view.song[0],
        track: view.track,
        pattern: 5,
        sequences: view.song[1].map((track) => [...track[1]]),
    }
    return view
}

function nextPlaybackFrame(view) {
    const id = view.playbackFrame
    const callback = frames.get(id)
    assert.equal(typeof callback, "function")
    frames.delete(id)
    callback()
}

test("song playhead follows rows, sequence boundaries, silence and audio tails", () => {
    const view = playingView()
    const before = JSON.stringify(view.song)
    const positions = []
    for (const row of [0, 31, 32, 63, 64, 95, 96, 120]) {
        view.audio.currentTime = 100 + row / 4
        positions.push(JSON.parse(JSON.stringify(view.playbackPosition())))
    }
    assert.deepEqual(positions, [
        { step: 0, pattern: 1, row: 0 },
        { step: 0, pattern: 1, row: 31 },
        { step: 1, pattern: null, row: 0 },
        { step: 1, pattern: null, row: 31 },
        { step: 2, pattern: 2, row: 0 },
        { step: 2, pattern: 2, row: 31 },
        { step: null, pattern: null, row: null },
        { step: null, pattern: null, row: null },
    ])
    assert.equal(view.step, 0)
    assert.equal(view.pattern, 0)
    assert.equal(view.row, 0)
    assert.equal(JSON.stringify(view.song), before)
})

test("playhead uses the rendered tempo and arrangement while following the viewed track", () => {
    const view = playingView()
    view.playback.rowLength = 8481
    view.playback.sequences[1] = [4]
    view.song[0] = 5513
    view.song[1][0][1] = [9]
    view.audio.currentTime = 100 + (8481 * 3 + 1) / 44100
    assert.equal(view.playbackPosition().row, 3)
    assert.equal(view.playbackPosition().pattern, 1)
    view.track = 1
    assert.equal(view.playbackPosition().pattern, 3)
    view.audio.currentTime = 100 + (8481 * 32 + 1) / 44100
    assert.equal(view.playbackPosition().step, 1)
    assert.equal(view.playbackPosition().pattern, null)
})

test("pattern playback highlights only the captured pattern and track for 32 rows", () => {
    const view = playingView("pattern")
    view.pattern = 8
    view.audio.currentTime = 100 + 31 / 4
    assert.deepEqual(JSON.parse(JSON.stringify(view.playbackPosition())), { step: null, pattern: 5, row: 31 })
    view.track = 1
    assert.equal(view.playbackPosition().pattern, null)
    view.track = 0
    view.audio.currentTime = 108
    assert.deepEqual(JSON.parse(JSON.stringify(view.playbackPosition())), { step: null, pattern: null, row: null })
})

test("playback highlights override selection without moving the keyboard tab stops", () => {
    const view = playingView()
    view.playback.sequences[0] = [2, 3, 0]
    const row = (dataset) => ({
        dataset,
        attributes: {},
        setAttribute(name, value) {
            this.attributes[name] = value
        },
    })
    const steps = [row({ step: "0" }), row({ step: "1" })]
    const notes = [row({ pattern: "0", row: "0" }), row({ pattern: "2", row: "3" })]
    view.querySelectorAll = (selector) =>
        selector === "tr[data-step]" ? steps : selector === "tr[data-pattern][data-row]" ? notes : []
    view.audio.currentTime = 100 + 35 / 4
    view.updateSelection()
    assert.deepEqual(
        steps.map((row) => row.attributes["aria-selected"]),
        ["false", "true"],
    )
    assert.deepEqual(
        notes.map((row) => row.attributes["aria-selected"]),
        ["false", "true"],
    )
    assert.deepEqual(
        steps.map((row) => row.tabIndex),
        [0, -1],
    )
    assert.deepEqual(
        notes.map((row) => row.tabIndex),
        [0, -1],
    )
    view.stop()
    assert.deepEqual(
        steps.map((row) => row.attributes["aria-selected"]),
        ["true", "false"],
    )
    assert.deepEqual(
        notes.map((row) => row.attributes["aria-selected"]),
        ["true", "false"],
    )
})

test("playback temporarily overrides and then restores the complete manual row range", () => {
    const view = playingView("pattern")
    view.rowAnchor = 2
    view.row = 4
    const notes = [
        [0, 2],
        [0, 3],
        [0, 4],
        [5, 6],
    ].map(([pattern, row]) => ({
        dataset: { pattern: String(pattern), row: String(row) },
        attributes: {},
        setAttribute(name, value) {
            this.attributes[name] = value
        },
    }))
    view.querySelectorAll = (selector) => (selector === "tr[data-pattern][data-row]" ? notes : [])
    view.audio.currentTime = 101.5
    view.updateSelection()
    assert.deepEqual(
        notes.map((row) => row.attributes["aria-selected"]),
        ["false", "false", "false", "true"],
    )
    view.stop()
    assert.equal(view.rowAnchor, 2)
    assert.equal(view.row, 4)
    assert.deepEqual(
        notes.map((row) => row.attributes["aria-selected"]),
        ["true", "true", "true", "false"],
    )
})

test("animation updates only on row changes and freezes while audio is paused", async () => {
    const view = playingView()
    let paints = 0
    view.updateSelection = () => {
        paints++
    }
    view.startPlaybackUpdates()
    assert.equal(paints, 1)
    view.audio.currentTime = 100.125
    nextPlaybackFrame(view)
    assert.equal(paints, 1)
    view.audio.currentTime = 100.25
    nextPlaybackFrame(view)
    assert.equal(paints, 2)
    const pending = view.playbackFrame
    const stale = frames.get(pending)
    await view.togglePlayback()
    assert.equal(view.paused, true)
    assert.equal(view.playbackFrame, null)
    assert.equal(frames.has(pending), false)
    assert.equal(view.playbackPosition().row, 1)
    stale()
    assert.equal(view.playbackFrame, null)
    await view.togglePlayback()
    assert.equal(view.paused, false)
    assert.ok(frames.has(view.playbackFrame))
    view.audio.currentTime = 100.5
    nextPlaybackFrame(view)
    assert.equal(view.playbackPosition().row, 2)
    const resumedFrame = view.playbackFrame
    view.stop()
    assert.equal(view.playback, null)
    assert.equal(view.playbackFrame, null)
    assert.equal(frames.has(resumedFrame), false)
})

test("cancelled playhead callbacks cannot interfere with a replacement or disconnected View", () => {
    const view = playingView()
    view.startPlaybackUpdates()
    const stale = frames.get(view.playbackFrame)
    view.clearPlayback()
    view.playback = { ...playingView().playback }
    view.startPlaybackUpdates()
    const replacementFrame = view.playbackFrame
    stale()
    assert.equal(view.playbackFrame, replacementFrame)
    assert.ok(frames.has(replacementFrame))
    view.isConnected = false
    nextPlaybackFrame(view)
    assert.equal(frames.has(replacementFrame), false)
    view.stop()
    assert.equal(view.playback, null)
})

test("note previews do not animate tracker rows", () => {
    const { view } = transport()
    view.source = {}
    view.startPlaybackUpdates()
    assert.equal(view.playbackPosition(), null)
    assert.equal(view.playbackFrame, null)
})

test("idle transport starts the selected song or pattern mode", async () => {
    for (const mode of ["song", "pattern"]) {
        const { view, icon, attributes } = transport()
        view.playMode = mode
        view.play = async (selected) => {
            assert.equal(selected, mode)
        }
        view.updateTransport()
        assert.equal(icon.textContent, "play_arrow")
        assert.equal(attributes["aria-label"], "Play")
        await view.togglePlayback()
    }
})

test("pause and resume keep the same source and switch the icon and accessible name", async () => {
    const { view, icon, attributes } = transport()
    const calls = []
    const playingSource = {}
    view.source = playingSource
    view.audio = { suspend: async () => calls.push("suspend"), resume: async () => calls.push("resume") }
    view.updateTransport()
    assert.equal(icon.textContent, "pause")
    assert.equal(attributes["aria-label"], "Pause")
    await view.togglePlayback()
    assert.equal(view.paused, true)
    assert.equal(icon.textContent, "play_arrow")
    assert.equal(attributes["aria-label"], "Resume")
    await view.togglePlayback()
    assert.equal(view.paused, false)
    assert.equal(icon.textContent, "pause")
    assert.equal(attributes["aria-label"], "Pause")
    assert.equal(view.source, playingSource)
    assert.deepEqual(calls, ["suspend", "resume"])
})

test("stopping paused playback clears its source and resets the toggle", () => {
    const { view, icon, attributes } = transport()
    const calls = []
    view.paused = true
    view.source = { stop: () => calls.push("stop"), disconnect: () => calls.push("disconnect") }
    const playingSource = view.source
    view.stop()
    assert.equal(playingSource.onended, null)
    assert.equal(view.source, null)
    assert.equal(view.paused, false)
    assert.equal(icon.textContent, "play_arrow")
    assert.equal(attributes["aria-label"], "Play")
    assert.deepEqual(calls, ["stop", "disconnect"])
})

test("failed audio suspension leaves transport state unchanged", async () => {
    const { view, icon } = transport()
    view.source = {}
    view.audio = {
        suspend: async () => {
            throw new Error("suspend failed")
        },
    }
    view.updateTransport()
    await assert.rejects(view.togglePlayback(), /suspend failed/)
    assert.equal(view.paused, false)
    assert.equal(icon.textContent, "pause")
})

test("a source stopped while suspension is pending cannot restore paused state", async () => {
    const { view, icon } = transport()
    let finishSuspending
    view.source = { stop() {}, disconnect() {} }
    view.audio = {
        suspend: () =>
            new Promise((resolve) => {
                finishSuspending = resolve
            }),
    }
    const pending = view.togglePlayback()
    view.stop()
    finishSuspending()
    await pending
    assert.equal(view.source, null)
    assert.equal(view.paused, false)
    assert.equal(icon.textContent, "play_arrow")
})

test("WAV buffer generation does not resume paused playback", async () => {
    const { view } = transport()
    view.paused = true
    let resumed = false
    view.audio = {
        resume: async () => {
            resumed = true
        },
    }
    assert.equal(await view.context(false), view.audio)
    assert.equal(resumed, false)
    assert.equal(view.paused, true)
})

test("natural completion resets transport; new playback resumes a suspended context", async () => {
    const { view, icon, attributes } = transport()
    view.song = model.createSong()
    view.track = 0
    view.pattern = 0
    const calls = []
    const playingSource = { connect() {}, start() {}, disconnect: () => calls.push("disconnect") }
    const samples = new Float32Array([0, 0.1, 0])
    view.audio = {
        currentTime: 100,
        resume: async () => calls.push("resume"),
        createBufferSource: () => playingSource,
        destination: {},
    }
    view.buffer = () => ({ duration: 1, getChannelData: () => samples })
    await view.play("song")
    assert.equal(icon.textContent, "pause")
    assert.equal(attributes["aria-label"], "Pause")
    const frame = view.playbackFrame
    assert.ok(frames.has(frame))
    playingSource.onended()
    assert.equal(view.playback, null)
    assert.equal(view.playbackFrame, null)
    assert.equal(frames.has(frame), false)
    assert.equal(view.source, null)
    assert.equal(view.paused, false)
    assert.equal(icon.textContent, "play_arrow")
    assert.equal(attributes["aria-label"], "Play")
    assert.deepEqual(calls, ["resume", "disconnect"])
})
