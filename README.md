# Music Making App

A browser music studio in a single page: step sequencer (3/4, 4/4, 5/4, 6/8, 7/8), scale-locked piano roll, multitrack timeline (up to 64 bars) with pattern and audio clips, automation, mixer with per-track filter / drive / delay & reverb sends, synth drums and instruments, a **sampler** for your own sounds, genre-based generators, MIDI keyboard input and recording tools (count-in, metronome, latency compensation).

**Live:** https://swellyis.github.io/music-app/

## Features at a glance
- **Projects**: autosave, a named project library (save as / open / rename / duplicate / delete) and `.json` import/export. Imported and recorded audio is stored in IndexedDB, so it survives reloads.
- **Export**: WAV (16/24-bit), MP3 and **FLAC** (built-in encoders, no upload), per-track stems (`.zip`, rendered one at a time to keep memory low), MIDI (real tempo, time signature, key signature, free notes), project files, **WebM video** of the visualizer with audio, a **standalone one-file HTML player**, Web Share, and **Copy project link** (compressed project in the URL hash; large projects fall back to a file).
- **Deterministic**: the project stores a random seed, so probability/humanize choices are identical in playback and every export (Re-roll picks a new one).
- **Composing**: tempo 30–300 BPM, 8 patterns (A–H), extra Lead 2 / Keys 2 / Pad tracks, 1/16, 1/32 and triplet grids, a **free-pitch polyphonic piano roll** (draw, move, resize, velocity, scale glow, fully keyboard-operable), chromatic two-row computer keyboard with octave keys, **clip launcher** (bar-quantised, with performance recording into the timeline), automation with curve shapes, LFO and master targets.
- **Audio tools**: per-clip source BPM, **tempo and key detection** (own onset/autocorrelation + chroma/Krumhansl code in a Worker), tonal/beat-aware time-stretch, gain, fades, reverse, pitch shift, slice at transients, a synthesised loop library, **vocal tools** (count-in take, vocal chain, trim, normalise), lyrics with **LRC** import/export.
- **MIDI**: import keeps chords/polyphony and reports tempo changes; **Web MIDI output** sends notes and clock to external gear.
- **Import**: drag and drop audio, MIDI or project files onto the page. MIDI import reads every bar.
- **Audio clips**: time-stretched to the project tempo in a Web Worker so the interface never freezes.
- **Accessibility**: keyboard-navigable grids (arrow keys, one tab stop each), keyboard move/resize of clips, high-contrast colours, screen-reader labels.
- **PWA**: install it from Chrome/Edge or Add to Home Screen on iOS; works fully offline. Lock-screen / media-key controls (play/pause state, scrubber, seek) via the Media Session API.
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
