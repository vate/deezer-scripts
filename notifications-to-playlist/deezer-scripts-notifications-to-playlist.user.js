// ==UserScript==
// @name         Deezer: Notifications to Playlist
// @namespace    https://github.com/vate/deezer-scripts
// @version      1.3.1
// @description  Adds a time-range dropdown + button next to the bell that pushes new-release notifications' tracks (within Today / This week / Last 2 weeks / Last month) into a chosen playlist. Override the playlist via the Tampermonkey menu.
// @author       Andrés Ortiz Massó
// @license      GPL-3.0
// @homepageURL  https://github.com/vate/deezer-scripts
// @supportURL   https://github.com/vate/deezer-scripts/issues
// @downloadURL  https://raw.githubusercontent.com/vate/deezer-scripts/main/notifications-to-playlist/deezer-scripts-notifications-to-playlist.user.js
// @updateURL    https://raw.githubusercontent.com/vate/deezer-scripts/main/notifications-to-playlist/deezer-scripts-notifications-to-playlist.user.js
// @match        https://www.deezer.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=deezer.com
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
	"use strict";

	// ---- CONFIG ---------------------------------------------------------------
	const TIME_RANGES = {
		today: { label: "Today", maxAgeMs: 24 * 3600e3 },
		week: { label: "This week", maxAgeMs: 7 * 24 * 3600e3 },
		fortnight: { label: "Last 2 weeks", maxAgeMs: 14 * 24 * 3600e3 },
		month: { label: "Last month", maxAgeMs: 30 * 24 * 3600e3 },
	};
	const CONFIG = {
		playlistId: null, // null = first sidebar playlist
		releaseTypeRegex: /NEW (SINGLE|ALBUM|EP|MIXTAPE|RELEASE)/i,
		rangeKey: "week", // one of Object.keys(TIME_RANGES)
		bellOpenTimeoutMs: 3500,
		bellStableMs: 400,
		expandTimeoutMs: 5000,
	};

	const gmGet = typeof GM_getValue === "function" ? GM_getValue : () => undefined;
	const gmSet = typeof GM_setValue === "function" ? GM_setValue : () => {};
	function cfg(key) {
		const stored = gmGet(key, undefined);
		return stored !== undefined && stored !== "" ? stored : CONFIG[key];
	}

	if (typeof GM_registerMenuCommand === "function") {
		GM_registerMenuCommand("Set playlist ID…", () => {
			const current = cfg("playlistId") ?? "";
			const v = prompt("Playlist ID (blank = first sidebar playlist):", current);
			if (v === null) return;
			gmSet("playlistId", v.trim() === "" ? "" : Number(v.trim()));
		});
		GM_registerMenuCommand("Reset to first playlist", () => gmSet("playlistId", ""));
		GM_registerMenuCommand("Clear processed albums (allow re-adding)", () => {
			gmSet("processedKeys", "");
			toast("Processed album history cleared");
		});
	}

	const GW = "/ajax/gw-light.php";
	const BTN_ID = "dz-notif-to-playlist-btn";

	async function gwCall(method, body, apiToken = "") {
		const url = `${GW}?api_version=1.0&api_token=${encodeURIComponent(apiToken)}&input=3&method=${method}`;
		const res = await fetch(url, {
			method: "POST",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body || {}),
		});
		if (!res.ok) throw new Error(`GW ${method} HTTP ${res.status}`);
		return res.json();
	}
	async function getApiToken() {
		const data = await gwCall("deezer.getUserData", {});
		return data?.results?.checkForm;
	}
	async function getAlbumTracks(albumId) {
		const ids = [];
		let url = `https://api.deezer.com/album/${albumId}`;
		let firstPage = true;
		while (url) {
			const r = await fetch(url);
			if (!r.ok) throw new Error(`album ${albumId} HTTP ${r.status}`);
			const j = await r.json();
			const page = firstPage ? j?.tracks : j;
			firstPage = false;
			(page?.data || []).forEach((t) => ids.push(String(t.id)));
			url = page?.next || null;
		}
		return ids;
	}
	async function addSongsToPlaylist(playlistId, trackIds, apiToken) {
		return gwCall(
			"playlist.addSongs",
			{
				PLAYLIST_ID: String(playlistId),
				SONGS: trackIds.map((id) => [String(id), 0]),
				OFFSET: -1,
				CTXT: { id: null, t: null },
			},
			apiToken,
		);
	}

	function resolvePlaylist() {
		const configured = cfg("playlistId");
		if (configured) return { id: String(configured), name: `playlist ${configured}` };
		const link = document.querySelector('a.playlist-item[href*="/playlist/"]');
		if (!link) return null;
		const m = link.pathname.match(/\/playlist\/(\d+)/);
		return m ? { id: m[1], name: (link.textContent || "").trim() } : null;
	}

	const getBell = () => document.querySelector('button[aria-label="Notifications"]');
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	// Deezer renders cached notification items into the popover immediately,
	// then swaps them for fresh data ~500–800ms later. Wait for the rendered
	// set (count + first item's title) to stay unchanged for `bellStableMs`
	// before returning — otherwise we read the stale cache and miss the
	// freshly-arrived unread items.
	async function openBell() {
		const bell = getBell();
		if (!bell) return null;
		if (bell.getAttribute("aria-expanded") !== "true") bell.click();
		const controlsId = bell.getAttribute("aria-controls");
		const fingerprint = (el) => {
			const items = el?.querySelectorAll(".notifications-item-container");
			if (!items?.length) return "";
			const first = items[0].querySelector(".heading-4")?.textContent?.trim() || "";
			return `${items.length}::${first}`;
		};
		const deadline = Date.now() + cfg("bellOpenTimeoutMs");
		const stableMs = cfg("bellStableMs");
		let lastFp = "";
		let stableSince = 0;
		while (Date.now() < deadline) {
			const el = controlsId ? document.getElementById(controlsId) : null;
			const fp = fingerprint(el);
			if (fp) {
				if (fp === lastFp) {
					if (!stableSince) stableSince = Date.now();
					if (Date.now() - stableSince >= stableMs) return el;
				} else {
					lastFp = fp;
					stableSince = 0;
				}
			}
			await sleep(50);
		}
		return controlsId ? document.getElementById(controlsId) : null;
	}
	function closeBell() {
		const bell = getBell();
		if (bell?.getAttribute("aria-expanded") === "true") bell.click();
	}

	// Deezer virtualizes the notifications list: items only enter the DOM as
	// the popover is scrolled. Force-render every notification by scrolling to
	// the bottom until the rendered count and scrollHeight stop growing.
	async function expandPopover(popover) {
		if (!popover) return;
		const scroller =
			[popover, ...popover.querySelectorAll("*")].find((el) => {
				const cs = el && window.getComputedStyle(el);
				return cs && /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
			}) || popover;

		let lastCount = -1;
		let lastHeight = -1;
		const deadline = Date.now() + cfg("expandTimeoutMs");
		while (Date.now() < deadline) {
			scroller.scrollTop = scroller.scrollHeight;
			await sleep(150);
			const count = popover.querySelectorAll(".notifications-item-container").length;
			const height = scroller.scrollHeight;
			if (count === lastCount && height === lastHeight) break;
			lastCount = count;
			lastHeight = height;
		}
		scroller.scrollTop = 0;
	}
	// Parse Deezer's relative notification date ("6 HOURS AGO", "1 WEEK AGO", etc.)
	// into milliseconds. Returns null if the format doesn't match.
	//
	// Deezer formats SINGULAR recent times with an article rather than a digit
	// ("AN HOUR AGO", "A MINUTE AGO", "A DAY AGO") and very-recent ones with no
	// unit at all ("JUST NOW", "A FEW SECONDS AGO"). We must treat "A"/"AN" as 1
	// and the seconds-bucket as ~0, or those items get dropped — which is why
	// the freshest notifications (~1 hour old) were never being added.
	const UNIT_MS = {
		SECOND: 1e3,
		MINUTE: 60e3,
		HOUR: 3600e3,
		DAY: 86400e3,
		WEEK: 7 * 86400e3,
		MONTH: 30 * 86400e3,
		YEAR: 365 * 86400e3,
	};
	function parseRelativeAgeMs(s) {
		if (!s) return null;
		const text = s.toUpperCase();
		// "just now", "moments ago", "a few seconds ago" → essentially zero age.
		if (/\b(JUST NOW|A? ?MOMENTS? AGO|A FEW SECONDS AGO)\b/.test(text)) return 0;
		// Quantity is either a digit or an article ("A" / "AN" → 1).
		const m = text.match(/(\d+|AN?)\s+(SECOND|MINUTE|HOUR|DAY|WEEK|MONTH|YEAR)S?\s+AGO/);
		if (!m) return null;
		const qty = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : 1;
		const unit = UNIT_MS[m[2]];
		return unit ? qty * unit : null;
	}

	function currentRange() {
		const key = cfg("rangeKey");
		return TIME_RANGES[key] || TIME_RANGES.week;
	}

	// An item is "in range" if its date matches the configured release-type regex
	// AND its parsed age is within the currently selected time range.
	function isInRange(item) {
		const re = cfg("releaseTypeRegex");
		const date = item.querySelector(".notifications-item-date")?.textContent || "";
		if (!re.test(date)) return false;
		const age = parseRelativeAgeMs(date);
		if (age === null) return false;
		return age <= currentRange().maxAgeMs;
	}

	// Visual debug marker: paint a high-contrast ring on every item the script
	// would currently pick. Magenta stands out against any Deezer theme.
	function markMatchingItems(popover) {
		if (!popover) return 0;
		let count = 0;
		popover.querySelectorAll(".notifications-item-container").forEach((item) => {
			item.style.outline = "";
			item.style.outlineOffset = "";
			if (isInRange(item)) {
				item.style.outline = "2px solid magenta";
				item.style.outlineOffset = "-2px";
				count++;
			}
		});
		return count;
	}

	function readNotificationAlbums(popover) {
		if (!popover) return [];
		const seen = new Set();
		const out = [];
		popover.querySelectorAll(".notifications-item-container").forEach((item) => {
			if (!isInRange(item)) return;
			const link = item.querySelector(".notifications-item-media-title a, .heading-4 a");
			const m = link?.pathname?.match(/\/album\/(\d+)/);
			if (!m || seen.has(m[1])) return;
			seen.add(m[1]);
			out.push({ id: m[1], title: (link.textContent || "").trim() });
		});
		return out;
	}

	function toast(msg, isError) {
		const n = document.createElement("div");
		n.textContent = msg;
		n.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:99999;padding:10px 14px;border-radius:6px;font:600 13px/1.3 system-ui,sans-serif;background:${isError ? "#a02020" : "#1f8a3b"};color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.45);max-width:380px`;
		document.body.appendChild(n);
		setTimeout(() => n.remove(), 5000);
	}
	const setBtnState = (b, label, busy) => {
		b.textContent = label;
		b.disabled = !!busy;
		b.style.opacity = busy ? "0.6" : "1";
		b.style.cursor = busy ? "wait" : "pointer";
	};

	function loadProcessed() {
		const raw = gmGet("processedKeys", "");
		if (!raw) return new Set();
		try {
			return new Set(JSON.parse(raw));
		} catch {
			return new Set();
		}
	}
	const saveProcessed = (set) => gmSet("processedKeys", JSON.stringify([...set]));
	const processedKey = (playlistId, albumId) => `${playlistId}:${albumId}`;

	async function run(btn) {
		setBtnState(btn, "…working", true);
		try {
			const playlist = resolvePlaylist();
			if (!playlist) return toast("No playlist found", true);

			const popover = await openBell();
			await expandPopover(popover);
			const allAlbums = readNotificationAlbums(popover);
			closeBell();
			const rangeLabel = currentRange().label;
			if (!allAlbums.length) return toast(`No new-release notifications in range "${rangeLabel}"`);

			const processed = loadProcessed();
			const albums = allAlbums.filter((a) => !processed.has(processedKey(playlist.id, a.id)));
			const skipped = allAlbums.length - albums.length;
			if (!albums.length) return toast(`All ${skipped} album(s) in "${rangeLabel}" already added to "${playlist.name}"`);

			const apiToken = await getApiToken();
			if (!apiToken) return toast("Could not fetch Deezer API token", true);

			let trackTotal = 0,
				albumOk = 0,
				albumFailed = 0;
			for (const a of albums) {
				try {
					const ids = await getAlbumTracks(a.id);
					if (!ids.length) {
						albumFailed++;
						continue;
					}
					const r = await addSongsToPlaylist(playlist.id, ids, apiToken);
					if (r?.error && Object.keys(r.error).length) {
						albumFailed++;
						continue;
					}
					trackTotal += ids.length;
					albumOk++;
					processed.add(processedKey(playlist.id, a.id));
				} catch {
					albumFailed++;
				}
			}
			saveProcessed(processed);
			toast(
				`Added ${trackTotal} track(s) from ${albumOk}/${albums.length} album(s) (${rangeLabel}) to "${playlist.name}"${albumFailed ? ` — ${albumFailed} failed` : ""}${skipped ? ` — ${skipped} skipped (already added)` : ""}`,
				albumFailed > 0 && albumOk === 0,
			);
		} catch (e) {
			console.error("[dz-notif-to-playlist]", e);
			toast("Error: " + (e?.message || e), true);
		} finally {
			setBtnState(btn, "+ Playlist", false);
		}
	}

	async function debugMarkMatches() {
		const popover = await openBell();
		await expandPopover(popover);
		const n = markMatchingItems(popover);
		const label = currentRange().label;
		toast(`Matched ${n} item(s) in "${label}" (magenta ring)`, n === 0);
	}

	function makePillButton(id, label, title, bg, onClick) {
		const btn = document.createElement("button");
		btn.id = id;
		btn.type = "button";
		btn.textContent = label;
		btn.title = title;
		btn.style.cssText = `margin-right:8px;padding:6px 12px;background:${bg};color:#fff;border:0;border-radius:999px;font:600 12px/1 system-ui,sans-serif;cursor:pointer`;
		btn.addEventListener("click", () => onClick(btn));
		return btn;
	}

	function makeRangeSelect() {
		const sel = document.createElement("select");
		sel.id = BTN_ID + "-range";
		sel.title = "Time range for the + Playlist / 🔍 Preview buttons";
		sel.style.cssText = `margin-right:8px;padding:6px 10px;background:#333;color:#fff;border:0;border-radius:999px;font:600 12px/1 system-ui,sans-serif;cursor:pointer`;
		for (const [key, { label }] of Object.entries(TIME_RANGES)) {
			const opt = document.createElement("option");
			opt.value = key;
			opt.textContent = label;
			sel.appendChild(opt);
		}
		const stored = gmGet("rangeKey", undefined);
		sel.value = stored && TIME_RANGES[stored] ? stored : CONFIG.rangeKey;
		sel.addEventListener("change", () => gmSet("rangeKey", sel.value));
		return sel;
	}

	function injectButton() {
		const bell = getBell();
		if (!bell?.parentElement) return;
		if (!document.getElementById(BTN_ID + "-range")) {
			bell.parentElement.insertBefore(makeRangeSelect(), bell);
		}
		if (!document.getElementById(BTN_ID)) {
			const btn = makePillButton(
				BTN_ID,
				"+ Playlist",
				"Add tracks from new-release notifications within the selected time range",
				"#a238ff",
				run,
			);
			bell.parentElement.insertBefore(btn, bell);
		}
		if (!document.getElementById(BTN_ID + "-debug")) {
			const dbg = makePillButton(
				BTN_ID + "-debug",
				"🔍 Preview",
				"Show which items the script will add for the selected range (no changes)",
				"#444",
				debugMarkMatches,
			);
			bell.parentElement.insertBefore(dbg, bell);
		}
	}

	let injectScheduled = false;
	function scheduleInject() {
		if (injectScheduled) return;
		injectScheduled = true;
		requestAnimationFrame(() => {
			injectScheduled = false;
			injectButton();
		});
	}
	new MutationObserver(scheduleInject).observe(document.body, { childList: true, subtree: true });
	injectButton();
})();
