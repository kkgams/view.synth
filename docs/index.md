---
title: Synth tracker
status: reference
---

# Synth tracker

`view-synth` is a Host-themed tracker using [PL_SYNTH by Dominic Szablewski](https://github.com/justgook/pl_synth). It provides 8 tracks, 32 rows per pattern, 9 patterns per track and 29 instrument controls. Styling and the View lifecycle come from GAMS, not the upstream tracker page.

## Usage

| Operation | Use |
| --- | --- |
| Patterns | Select a track using the sequencer's numbered column headers; all nine 32-row patterns appear side by side as plain note values. Click a row to select it; Shift+click selects the inclusive range from the anchor row to the clicked row within that pattern. Shift+Up/Down or Shift+Home/End extends/shrinks the range. A normal click or unmodified row movement selects one row; changing track/pattern starts a fresh selection. Left/Right move between patterns. Enter/Space select the focused row. Press an on-screen piano key to write its pitch to the selected row or every row in the selected range; selection stays in place. Direct text editing remains disabled. |
| Sequencer | Click a numbered column header to select its track: the header presses down and the corresponding column is highlighted. Header Left/Right and Home/End select tracks; Enter/Space activates the focused header. Eight track columns show read-only pattern numbers: `0` is silent, `1`–`9` select patterns. Click a row to select its step; clicking a track's value also selects that track and its non-silent pattern. Up/Down and Home/End select steps; Left/Right select tracks. Use the full-height, compact +/− buttons in the Sequencer heading to add/remove the last step across all tracks, up to 64 steps. Pattern numbers are currently read-only. |
| Shape sound | Edit the selected track's instrument panels below the patterns: oscillators, envelope/LFO and effects, plus the preset selector. Numeric instrument settings use integer-step sliders with their existing bounds; toggles and waveform/filter dropdowns are unchanged. Use the piano keyboard for note entry and auditioning. |
| Piano keyboard | The inline SVG keyboard beneath the instruments writes its pitch to the selected track/pattern row (or fills the Shift-selected row range), then previews that instrument. Writing does not advance or collapse the selection. It shows three octaves (initially C4–B6); octave up/down shifts the range, with starting octaves 0–7. Click a key, or focus it and press Enter/Space. Left/Right move chromatically; Home/End focus the first/last key. The pressed-key highlight clears when audio finishes or stops. Pressing a key replaces current playback. Written notes are kept even if audio preview fails; export JSON to save them. |
| Listen | Choose Song or Pattern in the header, then use Play/Pause to start, pause or resume at the same position. Row highlights follow the audio clock: Song follows the sequence step and the viewed track's active pattern; Pattern follows only the pattern that started playback. Pause freezes the highlight. Stop/completion restores your manual selection, including a multi-row range. Note previews do not advance rows. |
| Tempo | Change BPM in the header; changing tempo or playback mode stops the current playback. |
| Save or load | Use the header's folder icon to import JSON, disk icon to export JSON, or audio-file icon to export WAV. Import replaces the current song. |
| Render | Export the song as PCM WAV audio |

The sequencer, pattern tables and instrument panels share one nested-table workspace; there are no editor tabs or pattern pages. Pattern title headers select the active pattern, using the same click and Left/Right/Home/End/Enter/Space controls as track headers. Silent sequence steps have no active pattern highlight; highlights also clear during the final envelope/delay tail. Playback does not move keyboard focus or change song data. On shorter windows, scroll the workspace to reach the instrument panels.

## Song format

Songs use the upstream array representation:

```text
[row_len, [[instrument, sequence, patterns], ...]]
```

`row_len` is the number of audio samples per tracker row. Each track contains its 29-value instrument array, a sequence of pattern numbers (`0`–`9`) and nine 32-row note patterns. A zero note row is empty. Notes are displayed as names such as `C5` and `F#4`; JSON stores raw values `1`–`255`. `C5` is upstream note `147`. Sequences contain at most 64 steps per track. Rendering is limited to 120 seconds including delay tails and 50 million synthesized note samples, to bound memory and synchronous CPU work. Import/export preserves this format rather than adding a Project-specific wrapper. Import accepts strict JSON (up to 1 MiB), including compact arrays padded with `null`; JavaScript literals, C structs, legacy Sonant objects and share-link fragments are not supported. Import replaces the current song: export first. Work is retained during layout moves, but is not automatically saved to the Project.

## Development and installation

Run `make test check` for DSP, model, WAV and View interaction tests plus assembled JavaScript syntax. `make open` first builds `build.nosync/views/view-synth.js`, then opens the local Project in the released Host. Requires Make, Node.js 24, Python 3, curl, zip, unzip and tar; native Host download/launch requires macOS Apple Silicon.

`make package` creates incremental `build.nosync/view.synth.zip` and `SHA256SUMS`. The ZIP contains exactly `views/view-synth.js`, `LICENSE`, `NOTICE` and `licenses/pl_synth-MIT.txt`. Register `views/view-synth.js` as `view-synth` in a consuming Project; plugins, theme and UI Services remain separate dependencies.

`make serve-docs` previews this wiki on independent `DOCS_PORT=8080`; `make validate-docs` validates it and `make docs` builds `build.nosync/site/`. `make clean` removes all of `build.nosync/`, `tools/` and `gams_modules/` without ownership markers. It refuses tracked files or symlinks in deletion paths before deleting anything.

Requires GAMS v3.2.0 or newer for `$file` configuration. Native macOS launch and initial editing/preview flows were checked with the released Host; the current workspace uses simultaneous tables and an SVG piano rather than tabs. File import/download gestures and other platforms remain unverified.

## Attribution

PL_SYNTH is copyright Dominic Szablewski and distributed under MIT; it is based on Sonant by Jake Taylor. See the packaged `NOTICE`, `LICENSE` and `licenses/pl_synth-MIT.txt` for terms and attribution. No upstream tracker CSS or standalone page is required at runtime.
