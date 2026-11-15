# Synth

A Host-themed [PL_SYNTH](https://github.com/justgook/pl_synth) tracker for [GAMS](https://github.com/kkgams/gams): 8 tracks, 32 rows per pattern, 9 patterns per track and 29 instrument controls. Enter notes with the piano keyboard, select row ranges, play patterns or songs, import/export JSON songs and export PCM WAV audio.

| View | Local entry / package | Attribution |
| --- | --- | --- |
| `view-synth` | `build.nosync/views/view-synth.js` / `view.synth.zip` | [LICENSE](LICENSE), [NOTICE](NOTICE), [PL_SYNTH MIT license](licenses/pl_synth-MIT.txt) |

## Development

Requires Make, Node.js 24, Python 3, curl, zip, unzip and tar; no package installation or sibling checkout. Host download/launch requires macOS Apple Silicon.

| Command | Purpose |
| --- | --- |
| `make build` | Assemble vendor synth, model and View into one blob-loadable module |
| `make test` | Run native Node DSP, model, WAV and View interaction tests |
| `make check` | Build and syntax-check the assembled module |
| `make open` | Build, then open this repository's `gams.json` in the Host |
| `make package` | Incremental `build.nosync/view.synth.zip` and `SHA256SUMS` |
| `make serve-docs` | Preview pinned wiki; independent `DOCS_PORT=8080` |
| `make validate-docs` / `make docs` | Validate / build `build.nosync/site/` |
| `make clean` | Remove named generated outputs, marked Host download and completed configured Unit caches; preserve supplied tools and unknown caches |

Edit `src/vendor/pl_synth.js`, `src/model.mjs` and `src/views/view-synth.js`. Make concatenates them in that order, stripping model `export ` prefixes. Only the Host helper remains imported. The Project loads the assembled module, not source files individually.

First launch downloads pinned GAMS v3.2.0 and resolves pinned supporting Units. Existing tools are not updated implicitly; downloaded Host notices remain beside the app. Launch sets `GAMS_APP_CWD` and selects local `gams.json`. Clean refuses tracked output, symlinks and unidentified tools/caches.

Requires GAMS v3.2.0 or newer for the `$file` Project configuration. Native macOS launch and initial editing/preview flows were checked in the released Host; the workspace now shows sequencer, patterns, instruments and piano together without tabs. File import/download gestures and other platforms remain unverified.

[Usage and song format](docs/index.md).
