# Deezer: Bulk Remove Above

A userscript that adds a small **`↥ Remove this & above`** pill to every track row on a Deezer playlist page. Hover any row, click the pill, and that track plus every track above it is removed from the playlist in a single batch call.

## Install

1. Install a userscript manager:
   - [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Edge, Safari, Firefox)
   - [Violentmonkey](https://violentmonkey.github.io/) (Chrome, Edge, Firefox)
   - [Greasemonkey](https://www.greasespot.net/) (Firefox)
2. Open the raw script in your browser and confirm install:

   [**Install `deezer-scripts-bulk-remove.user.js`**](https://raw.githubusercontent.com/vate/deezer-scripts/main/bulk-remove/deezer-scripts-bulk-remove.user.js)

## Usage

Open any Deezer playlist page (`deezer.com/.../playlist/<id>`) while logged in. Hover a track row — a magenta pill appears at the right edge of the row. Click it and confirm the dialog to remove that track and every track above it.

A toast in the bottom-right reports the result, and the page reloads so the list re-renders cleanly.

## How it works

1. Reads `(title, album ID, primary artist ID)` from the hovered row's DOM.
2. Calls `playlist.getSongs` via Deezer's internal GW endpoint to fetch the full ordered track list.
3. Finds the matching song's index and slices `0..=index` to build the removal set.
4. Calls `playlist.deleteSongs` with all the track IDs in one batch.

## Configuration

Open your userscript manager's menu (Tampermonkey extension popup → this script's entry):

| Menu command | Stored as | Default |
| --- | --- | --- |
| **Set confirm threshold…** | `confirmThreshold` — skip the confirm dialog when removing N or fewer tracks | `0` (always confirm) |

## Permissions (`@grant`)

| Grant | Why |
| --- | --- |
| `GM_getValue` / `GM_setValue` | Persist the confirm threshold across page loads. |
| `GM_registerMenuCommand` | Adds the configuration entry to the userscript manager's menu. |

No `@connect` is required — all `fetch` calls go to `deezer.com`, same-origin.

## Privacy

Only talks to Deezer's own internal endpoint (`deezer.com/ajax/gw-light.php`, the same API the website uses). No third-party requests, no telemetry.

## License

GPL-3.0 — see [LICENSE](../LICENSE) at the repo root.
