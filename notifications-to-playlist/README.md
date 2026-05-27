# Deezer: Notifications to Playlist

A userscript that adds a **time-range dropdown** and a **`+ Playlist`** button next to the Deezer notifications bell. Pick a range (Today / This week / Last 2 weeks / Last month), click the button, and every track from new-release notifications within that range is appended to a playlist of your choice.

## Install

1. Install a userscript manager:
   - [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Edge, Safari, Firefox)
   - [Violentmonkey](https://violentmonkey.github.io/) (Chrome, Edge, Firefox)
   - [Greasemonkey](https://www.greasespot.net/) (Firefox)
2. Open the raw script in your browser and confirm install:

   [**Install `deezer-scripts-notifications-to-playlist.user.js`**](https://raw.githubusercontent.com/vate/deezer-scripts/main/notifications-to-playlist/deezer-scripts-notifications-to-playlist.user.js)

   Userscript managers detect the `.user.js` suffix and show an install prompt.

## Usage

Open [deezer.com](https://www.deezer.com/) while logged in. A dropdown and two pill buttons appear next to the notifications bell:

| Control | What it does |
| --- | --- |
| **Range dropdown** | Picks the time window: `Today`, `This week`, `Last 2 weeks`, `Last month`. Default is `This week`. The selected value is persisted via `GM_setValue`. |
| **`+ Playlist`** | Opens the notifications popover, picks new-release entries whose age is within the selected range, reads each album's tracks, and appends them to the target playlist. Albums it has already added are skipped automatically. |
| **`🔍 Preview`** | Diagnostic only — outlines in magenta every notification that *would* be added for the current range. No API calls, no changes. Use this to confirm the range before clicking `+ Playlist`. |

A toast in the bottom-right reports the result: `Added N track(s) from X/Y album(s) (<range>) to "<playlist name>"`.

## How items are selected

For each notification visible in the bell popover the script:

1. Reads the date label (`6 HOURS AGO`, `1 WEEK AGO`, `2 DAYS AGO`, …).
2. Matches it against `releaseTypeRegex` — the date label must end with one of `NEW SINGLE / ALBUM / EP / MIXTAPE / RELEASE`.
3. Parses the relative age (`MINUTE/HOUR/DAY/WEEK/MONTH/YEAR`) into milliseconds and keeps the item if `age ≤ rangeMaxAge`.

So the previous theme-accent "unread dot" detector is gone — items are now selected purely by what's printed on each notification, which is stable across Deezer's themes and read/unread state changes.

## Configuration

Open your userscript manager's menu (Tampermonkey extension popup → this script's entry):

| Menu command | Stored as | Default |
| --- | --- | --- |
| **Set playlist ID…** | `playlistId` — numeric Deezer playlist ID | first user playlist in the sidebar |
| **Reset to first playlist** | clears `playlistId` | – |
| **Clear processed albums (allow re-adding)** | clears `processedKeys` | – |

To find a playlist ID, open the playlist on deezer.com — the URL is `https://www.deezer.com/.../playlist/1234567890`.

Other tunables (edit the `CONFIG` and `TIME_RANGES` objects at the top of the script):

- `TIME_RANGES` — add or edit the dropdown entries. Each entry is `{ label, maxAgeMs }`.
- `rangeKey` — the default range key used when nothing is stored yet.
- `releaseTypeRegex` — which notification subtitles count as "new release".
- `bellOpenTimeoutMs` / `bellStableMs` — popover open timeout and the "content has settled" debounce window (the popover often shows cached items first and swaps in fresh ones ~500–800ms later).
- `expandTimeoutMs` — how long to scroll the virtualized notifications list to force all items into the DOM.

## Permissions (`@grant`)

| Grant | Why |
| --- | --- |
| `GM_getValue` / `GM_setValue` | Persist `playlistId`, the selected range, and the processed-albums set across page loads. |
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
| `No new-release notifications in range "<X>"` after click | Either the range is too narrow, or none of the visible items match `releaseTypeRegex`. Use **`🔍 Preview`** to verify, and try a wider range. |
| Same albums added twice | Use **Clear processed albums** menu command to reset, or open an issue if the dedupe key collided. |

## License

GPL-3.0 — see [LICENSE](../LICENSE) at the repo root.
