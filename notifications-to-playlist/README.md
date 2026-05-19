# Deezer: Notifications to Playlist

A userscript that adds a **`+ Playlist`** button next to the Deezer notifications bell. Clicking it scans your unread "new release" notifications (the ones marked with the theme-accent dot — pink, blue, or whichever color your active Deezer theme uses) and appends every track from those albums to a playlist of your choice.

## Install

1. Install a userscript manager:
   - [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Edge, Safari, Firefox)
   - [Violentmonkey](https://violentmonkey.github.io/) (Chrome, Edge, Firefox)
   - [Greasemonkey](https://www.greasespot.net/) (Firefox)
2. Open the raw script in your browser and confirm install:

   [**Install `deezer-scripts-notifications-to-playlist.user.js`**](https://raw.githubusercontent.com/vate/deezer-scripts/main/notifications-to-playlist/deezer-scripts-notifications-to-playlist.user.js)

   Userscript managers detect the `.user.js` suffix and show an install prompt.

## Usage

Open [deezer.com](https://www.deezer.com/) while logged in. Two pill buttons appear next to the notifications bell:

| Button | What it does |
| --- | --- |
| **`+ Playlist`** | Opens the notifications popover, picks unread new-release entries, reads each album's tracks, and appends them to the target playlist. Albums it has already added are skipped automatically. |
| **`🔍 Unread`** | Diagnostic only — outlines in magenta every notification the script considers unread. No API calls, no changes. Use this if Deezer's DOM changes and detection seems off. |

A toast in the bottom-right reports the result: `Added N track(s) from X/Y album(s) to "<playlist name>"`.

## Configuration

Open your userscript manager's menu (Tampermonkey extension popup → this script's entry):

| Menu command | Stored as | Default |
| --- | --- | --- |
| **Set playlist ID…** | `playlistId` — numeric Deezer playlist ID | first user playlist in the sidebar |
| **Reset to first playlist** | clears `playlistId` | – |
| **Clear processed albums (allow re-adding)** | clears `processedKeys` | – |

To find a playlist ID, open the playlist on deezer.com — the URL is `https://www.deezer.com/.../playlist/1234567890`.

Other tunables (edit the `CONFIG` object at the top of the script):

- `releaseTypeRegex` — which notification subtitles count as "new release". Default matches `NEW SINGLE / ALBUM / EP / MIXTAPE / RELEASE`.
- `bellOpenTimeoutMs` — max ms to wait for the notifications popover to render (default `2000`).

## How "unread" is detected

Deezer marks unread notifications with a small theme-accent dot rendered as a `::before` pseudo-element on the `.heading-4` title. The exact color depends on your active Deezer theme (it used to be pink; modern themes use blue, red, etc.), so the script just checks for an opaque `::before` background rather than matching a specific RGB. The **`🔍 Unread`** button is the visual probe — if it shows zero hits when you can clearly see unread notifications, Deezer has likely changed the DOM and the detector needs updating.

## Permissions (`@grant`)

| Grant | Why |
| --- | --- |
| `GM_getValue` / `GM_setValue` | Persist `playlistId` and the processed-albums set across page loads. |
| `GM_registerMenuCommand` | Adds the configuration entries to the userscript manager's menu. |

No `@connect` is required — all `fetch` calls go to `deezer.com` and `api.deezer.com`, both same-origin / public.

## Compatibility

Tested with Tampermonkey 5.x on Chromium and Firefox. Should work on any GM4-compatible manager that supports the three `GM_*` grants above.

## Privacy

Only talks to Deezer's own endpoints — `deezer.com/ajax/gw-light.php` (the same internal API the website uses) and `api.deezer.com` (the public API). No third-party requests, no telemetry. Your Deezer API token is read the same way the website reads it and is only used to add songs to your playlist.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `No playlist found` | No `playlistId` set and no playlist in the sidebar. Set one via the menu. |
| `Could not fetch Deezer API token` | Logged out, or Deezer returned an unexpected response. Reload while logged in. |
| `No new release notifications visible` after click | Popover didn't open in time, or no items match `releaseTypeRegex`. Try **`🔍 Unread`** to verify detection. |
| Same albums added twice | Use **Clear processed albums** menu command to reset, or open an issue if the dedupe key collided. |

## License

GPL-3.0 — see [LICENSE](../LICENSE) at the repo root.
