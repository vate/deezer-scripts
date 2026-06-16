# Deezer: Zoom Cover on Click

A userscript that makes the album cover on a Deezer album page clickable. Click the cover and it opens full-size in a centered lightbox over a dimmed, blurred backdrop — the same thing the **⋯ → Zoom on the Cover** menu does, but in one click. Click anywhere or press <kbd>Esc</kbd> to close.

## Install

1. Install a userscript manager:
   - [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Edge, Safari, Firefox)
   - [Violentmonkey](https://violentmonkey.github.io/) (Chrome, Edge, Firefox)
   - [Greasemonkey](https://www.greasespot.net/) (Firefox)
2. Open the raw script in your browser and confirm install:

   [**Install `deezer-scripts-zoom-cover.user.js`**](https://raw.githubusercontent.com/vate/deezer-scripts/main/zoom-cover/deezer-scripts-zoom-cover.user.js)

## Usage

Open any Deezer album page (`deezer.com/.../album/<id>`). The cover shows a zoom-in cursor on hover — click it to open the full-size image. Click the backdrop or press <kbd>Esc</kbd> to dismiss.

## How it works

1. A delegated `click` listener catches clicks on the masthead cover (`[data-testid="album-cover"]`), so it keeps working as Deezer re-renders the page on navigation.
2. The cover `<img>` src looks like `…/images/cover/<hash>/500x500-000000-80-0-0.jpg`. The script swaps the `WxH` size token for `1500x1500`; Deezer's CDN serves the highest resolution it has (it caps to the source, so over-asking is safe).
3. That high-res image is shown in a fixed full-screen overlay.

## Permissions (`@grant`)

None. The script only reads the cover's existing image URL and renders an overlay — no `fetch`, no storage, no `@connect`.

## Privacy

No third-party requests, no telemetry. The lightbox image is loaded from Deezer's own CDN (`cdn-images.dzcdn.net`), the same host the page already uses for the cover.

## License

GPL-3.0 — see [LICENSE](../LICENSE) at the repo root.
