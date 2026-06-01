// ==UserScript==
// @name         Deezer: Notifications to Playlist
// @namespace    https://github.com/vate/deezer-scripts
// @version      2.0.0
// @description  Adds a time-range dropdown + button next to the bell that pushes new-release notifications' tracks (within Today / This week / Last 2 weeks / Last month) into a chosen playlist. Reads the notification feed directly from Deezer's API (no popover scraping). Override the playlist via the Tampermonkey menu.
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
		notificationFetchCount: 40, // how many notifications to request from notification.list
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
	async function getUserData() {
		const data = await gwCall("deezer.getUserData", {});
		return { apiToken: data?.results?.checkForm, userId: data?.results?.USER?.USER_ID };
	}
	// Fetch the raw notification feed (new releases, social, etc.) straight from
	// Deezer's GW API. This is a fresh server call every time — no DOM, no cached
	// in-memory store, no read-state — so the newest release is always present.
	async function fetchNotifications(apiToken, userId) {
		const res = await gwCall("notification.list", { USER_ID: userId, NB: cfg("notificationFetchCount") }, apiToken);
		return res?.results?.data || [];
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

	function currentRange() {
		const key = cfg("rangeKey");
		return TIME_RANGES[key] || TIME_RANGES.week;
	}

	// Build the de-duplicated list of in-range new-release albums from a raw
	// `notification.list` payload. Each notification carries an exact ISO `date`
	// (so no relative-time parsing) and a `footer` like "1 HOUR AGO - NEW SINGLE"
	// matched against the configured release-type regex. We keep only the ones
	// that point at an album.
	function readReleaseAlbums(notifications) {
		const re = cfg("releaseTypeRegex");
		const maxAgeMs = currentRange().maxAgeMs;
		const now = Date.now();
		const seen = new Set();
		const out = [];
		for (const n of notifications) {
			if (n?.picture?.media_type !== "album") continue;
			if (!re.test(n.footer || "")) continue;
			const t = Date.parse(n.date);
			if (Number.isNaN(t)) continue;
			if (now - t > maxAgeMs) continue; // future dates (clock skew, age < 0) stay in range
			const id = String(n.picture.media_id || (n.url || "").match(/\/album\/(\d+)/)?.[1] || "");
			if (!id || seen.has(id)) continue;
			seen.add(id);
			out.push({ id, title: n.title || "" });
		}
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

			const { apiToken, userId } = await getUserData();
			if (!apiToken || !userId) return toast("Could not fetch Deezer API token", true);

			const notifications = await fetchNotifications(apiToken, userId);
			const allAlbums = readReleaseAlbums(notifications);
			const rangeLabel = currentRange().label;
			if (!allAlbums.length) return toast(`No new-release notifications in range "${rangeLabel}"`);

			const processed = loadProcessed();
			const albums = allAlbums.filter((a) => !processed.has(processedKey(playlist.id, a.id)));
			const skipped = allAlbums.length - albums.length;
			if (!albums.length) return toast(`All ${skipped} album(s) in "${rangeLabel}" already added to "${playlist.name}"`);

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
		sel.title = "Time range for the + Playlist button";
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
