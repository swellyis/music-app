# Third-party components

- **lamejs 1.2.1** (MP3 encoder, JavaScript port of LAME) — LGPL-3.0, https://github.com/zhuker/lamejs. It is embedded unmodified (minified build) as an inert text block in `index.html` (`<script type="text/plain" id="w-lame">`) and run inside a Web Worker for MP3 export. You may replace it by editing that block; the library's source and licence are available at the link above.
- **Manrope** and **IBM Plex Mono** fonts — SIL Open Font License 1.1, embedded as base64 WOFF2.
