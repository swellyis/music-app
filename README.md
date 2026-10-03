# Music Making App

A browser music studio in a single page: step sequencer (3/4, 4/4, 5/4, 6/8, 7/8), scale-locked piano roll, multitrack timeline (up to 64 bars) with pattern and audio clips, automation, mixer with per-track filter / drive / delay & reverb sends, synth drums and instruments, a **sampler** for your own sounds, genre-based generators, MIDI keyboard input and recording tools (count-in, metronome, latency compensation).

**Live:** https://swellyis.github.io/music-app/

## Features at a glance
- **Projects**: autosave, a named project library (save as / open / rename / duplicate / delete) and `.json` import/export. Imported and recorded audio is stored in IndexedDB, so it survives reloads.
- **Export**: WAV (16- or 24-bit), MP3 (built-in encoder, no upload), per-track stems (`.zip`), MIDI (real tempo, time signature and key signature) and project files.
- **Import**: drag and drop audio, MIDI or project files onto the page. MIDI import reads every bar.
- **Audio clips**: time-stretched to the project tempo in a Web Worker so the interface never freezes.
- **Accessibility**: keyboard-navigable grids (arrow keys, one tab stop each), keyboard move/resize of clips, high-contrast colours, screen-reader labels.
- **PWA**: install it from Chrome/Edge or Add to Home Screen on iOS; works fully offline. Lock-screen / media-key controls via the Media Session API.
- **Security**: strict Content-Security-Policy (no remote scripts, no inline event handlers), strict validation of imported projects.

## Install and offline use
Open the link in Chrome or Edge and use **Install app**, or on iPhone/iPad choose Share → **Add to Home Screen**. After the first load it works fully offline.

## Files
- `index.html` — the whole app (HTML, CSS, JS, fonts and the MP3 encoder inline)
- `manifest.webmanifest`, `sw.js`, `icons/` — PWA files (including the 1200×630 link-preview image `icons/og-image.png`)
- `tests/` — end-to-end regression tests (node + playwright-core + headless Chrome), see `tests/README.md`
- `THIRD_PARTY.md` — licences of bundled components
- All paths are relative, so it runs from any sub-path or can be opened directly as a file.

## Running the tests
```bash
npm i playwright-core            # or set PLAYWRIGHT_MODULE to an existing copy
CHROME=/usr/bin/google-chrome node tests/run.mjs        # tests the files in this folder
node tests/run.mjs --url https://swellyis.github.io/music-app/   # tests the live site
```
