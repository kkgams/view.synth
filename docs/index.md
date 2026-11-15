---
title: Synth tracker
status: reference
---

# Synth tracker

`view-synth` is a Host-themed tracker using [PL_SYNTH by Dominic Szablewski](https://github.com/justgook/pl_synth). It provides 8 tracks, 32 rows per pattern, 9 patterns per track and 29 instrument controls. Styling and the View lifecycle come from GAMS, not the upstream tracker page.

## Usage

| Operation | Use |
| --- | --- |
| Compose | Select a track and pattern, then edit its note rows |
| Arrange | Enter sequence numbers `0`–`9`: `0` is silent, `1`–`9` select patterns |
| Shape sound | Edit the selected track's 29 instrument controls |
| Listen | Choose Song or Pattern in the header, then use Play/Pause to start, pause or resume at the same position; Stop resets playback. Note previews remain in the editor. |
| Tempo | Change BPM in the header; changing tempo or playback mode stops the current playback. |
| Save or load | Use the header's folder icon to import JSON, disk icon to export JSON, or audio-file icon to export WAV. Import replaces the current song. |
| Render | Export the song as PCM WAV audio |

## Song format

Songs use the upstream array representation:

```text
[row_len, [[instrument, sequence, patterns], ...]]
```

`row_len` is the number of audio samples per tracker row. Each track contains its 29-value instrument array, a sequence of pattern numbers (`0`–`9`) and nine 32-row note patterns. A zero note row is empty. Notes can be entered as `C5`, `F#4`, or raw values `1`–`255`; `C5` is upstream note `147`. Sequences contain at most 64 steps per track. Rendering is limited to 120 seconds including delay tails and 50 million synthesized note samples, to bound memory and synchronous CPU work. Import/export preserves this format rather than adding a Project-specific wrapper. Import accepts strict JSON (up to 1 MiB), including compact arrays padded with `null`; JavaScript literals, C structs, legacy Sonant objects and share-link fragments are not supported. Import replaces the current song: export first. Work is retained during layout moves, but is not automatically saved to the Project.

## Development and installation

Run `make test check` for model tests and assembled JavaScript syntax. `make open` first builds `build.nosync/views/view-synth.js`, then opens the local Project in the released Host. Requires Make, Node.js 24, Python 3, curl, zip, unzip and tar; native Host download/launch requires macOS Apple Silicon.

`make package` creates incremental `build.nosync/view.synth.zip` and `SHA256SUMS`. The ZIP contains exactly `views/view-synth.js`, `LICENSE`, `NOTICE` and `licenses/pl_synth-MIT.txt`. Register `views/view-synth.js` as `view-synth` in a consuming Project; plugins, theme and UI Services remain separate dependencies.

`make serve-docs` previews this wiki on independent `DOCS_PORT=8080`; `make validate-docs` validates it and `make docs` builds `build.nosync/site/`. `make clean` removes named generated outputs and identified downloads, refusing tracked files, symlinks and unidentified tools/caches. Supplied tools and unknown caches are preserved.

Requires GAMS v3.2.0 or newer for `$file` configuration. Local launch, note editing, editor tabs and preview playback were checked with the released macOS Host. File import/download gestures and other platforms remain unverified.

## Attribution

PL_SYNTH is copyright Dominic Szablewski and distributed under MIT; it is based on Sonant by Jake Taylor. See the packaged `NOTICE`, `LICENSE` and `licenses/pl_synth-MIT.txt` for terms and attribution. No upstream tracker CSS or standalone page is required at runtime.
