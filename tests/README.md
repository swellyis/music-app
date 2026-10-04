# Tests

Lightweight end-to-end regression tests for Music Making App: **node + playwright-core + headless Chrome**, no framework.

```bash
# 1. build the app (from the source folder)
bash build.sh                       # writes ../music-app/{index.html,sw.js,manifest.webmanifest,icons/}

# 2. run everything against the built files (a throw-away static server is started automatically)
node tests/run.mjs

# options
node tests/run.mjs --dir /path/to/built/app     # default: ../music-app (or $APP_DIR)
node tests/run.mjs --url https://swellyis.github.io/music-app/   # test a deployed copy
node tests/run.mjs --only contrast              # run tests whose name contains the text
```

Environment: `PLAYWRIGHT_MODULE` (path to `playwright-core/index.mjs`, default `/workspace/tools/node_modules/...`),
`CHROME` (browser binary, default `/usr/bin/google-chrome`). Exit code is 1 when any test fails.

## What is covered

| Area | Checks |
| --- | --- |
| Static | every source module parses; CSP meta present and strict (no inline/eval/remote script); no remote resources; old name gone; Open Graph / Twitter tags |
| Boot | no console errors/warnings on desktop and mobile viewports; 144 step buttons + 240 piano-roll cells; one tab stop per grid |
| Offline / PWA | service worker installs, cache exists, offline reload works and plays |
| Persistence | imported audio and sampler samples survive a reload (IndexedDB), library save/open restores audio |
| Security | malicious project JSON (HTML in ids/names, URLs as audio sources, out-of-range numbers): no script runs, no network request to the attacker host, ids sanitised; CSP blocks inline script and remote fetch/worker/image |
| Long audio | 150 s clip is trimmed with a warning toast; song length options up to 64 bars; 64-bar generation + offline render |
| Worker | 60 s clip is time-stretched in a Worker: main thread never blocked (max timer gap), duration and 440 Hz pitch preserved |
| Meters | step grids of 12/12/20/14 steps for 3/4, 6/8, 5/4, 7/8; metronome accents; MIDI time-signature and key-signature bytes |
| MIDI import | 24-bar 3/4 file: all bars, tempo/meter adopted, patterns + arrangement |
| Library | save, save-as, open, rename, duplicate, delete; unsaved-changes confirm; Undo restores the replaced project |
| Export | 24-bit WAV header, MP3 MPEG frames + duration, stems `.zip` (valid RIFF, equal lengths) |
| Sound | per-track filter/drive/delay/reverb change the render; sampler pitch (C4 → 262 Hz, C5 → 523 Hz); held notes sustain > 15 s |
| Recording | count-in length, metronome while recording, latency compensation moves recorded steps, mic released on every failure path |
| Accessibility | roving tabindex + arrow keys, keyboard clip move/resize, text contrast ≥ 4.5:1 (light + dark, several dialogs), accessible names for all controls, live region |
| Performance | idle visualizer draws 0 frames; one step toggle changes only a handful of grid DOM nodes; draws stop after playback ends |
| Misc | drag-and-drop of audio/project files, Media Session metadata/state, decoded-audio release, no horizontal overflow on mobile |

The PWA install/update flow is additionally exercised by the older scripts in the source folder (`fpwa.mjs`, `flive.mjs`).

## Notes

* Tests use the `window.__beat` debug hook that the app exposes (state, transport, import/export helpers).
* Some tests render audio offline and take a few seconds.

Tests named `[A] …` cover the bug-fix milestone, `[B] …` the feature milestone (detection, clip tools, free-pitch roll, launcher, automation, sharing, FLAC, video, lyrics, vocal tools, MIDI output). Use `--only "[B] "` to run just those.
