// ==UserScript==
// @name         Deezer: Notifications to Playlist
// @namespace    https://www.deezer.com/
// @version      1.1.0
// @description  Adds a button next to the bell that pushes unread (pink-dot) new-release notifications' tracks into a chosen playlist (defaults to the first one in the sidebar; override via Tampermonkey menu).
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
	const CONFIG = {
		playlistId: null, // null = first sidebar playlist
		releaseTypeRegex: /NEW (SINGLE|ALBUM|EP|MIXTAPE|RELEASE)/i,
		bellOpenTimeoutMs: 2000,
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
	async function openBell() {
		const bell = getBell();
		if (!bell) return null;
		if (bell.getAttribute("aria-expanded") !== "true") bell.click();
		const controlsId = bell.getAttribute("aria-controls");
		const deadline = Date.now() + cfg("bellOpenTimeoutMs");
		while (Date.now() < deadline) {
			const el = controlsId ? document.getElementById(controlsId) : null;
			if (el?.querySelector(".notifications-item-container")) return el;
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
	// Robust transparent check — handles both Chrome ("rgba(0, 0, 0, 0)")
	// and Firefox ("rgba(0,0,0,0)" / "transparent") output formats.
	function bgAlpha(colorStr) {
		if (!colorStr || colorStr === "transparent") return 0;
		const m = colorStr.match(/rgba?\(([^)]+)\)/);
		if (!m) return 1;
		const parts = m[1].split(",").map((s) => parseFloat(s));
		return parts.length === 4 ? parts[3] : 1;
	}

	// An item is "unread" if its `.heading-4` carries the pink `::before` dot
	// (a non-transparent background on the pseudo-element).
	function isUnreadItem(item) {
		const h = item.querySelector(".heading-4");
		if (!h) return false;
		const cs = window.getComputedStyle(h, "::before");
		if (cs.content === "none" || cs.content === "normal") return false;
		return bgAlpha(cs.backgroundColor) > 0;
	}

	// Visual debug marker: paint a pink ring on every item the script thinks is unread.
	function markUnreadItems(popover) {
		if (!popover) return 0;
		let count = 0;
		popover.querySelectorAll(".notifications-item-container").forEach((item) => {
			item.style.outline = "";
			item.style.outlineOffset = "";
			if (isUnreadItem(item)) {
				item.style.outline = "2px solid rgb(243, 131, 251)";
				item.style.outlineOffset = "-2px";
				count++;
			}
		});
		return count;
	}

	function readNotificationAlbums(popover) {
		if (!popover) return [];
		const re = cfg("releaseTypeRegex");
		const seen = new Set();
		const out = [];
		popover.querySelectorAll(".notifications-item-container").forEach((item) => {
			if (!isUnreadItem(item)) return;
			const date = item.querySelector(".notifications-item-date")?.textContent || "";
			if (!re.test(date)) return;
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
			if (!allAlbums.length) return toast("No new release notifications visible");

			const processed = loadProcessed();
			const albums = allAlbums.filter((a) => !processed.has(processedKey(playlist.id, a.id)));
			const skipped = allAlbums.length - albums.length;
			if (!albums.length) return toast(`All ${skipped} album(s) already added to "${playlist.name}"`);

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
				`Added ${trackTotal} track(s) from ${albumOk}/${albums.length} album(s) to "${playlist.name}"${albumFailed ? ` — ${albumFailed} failed` : ""}${skipped ? ` — ${skipped} skipped (already added)` : ""}`,
				albumFailed > 0 && albumOk === 0,
			);
		} catch (e) {
			console.error("[dz-notif-to-playlist]", e);
			toast("Error: " + (e?.message || e), true);
		} finally {
			setBtnState(btn, "+ Playlist", false);
		}
	}

	async function debugMarkUnread() {
		const popover = await openBell();
		await expandPopover(popover);
		const n = markUnreadItems(popover);
		toast(`Detected ${n} unread item(s) (pink ring)`, n === 0);
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

	function injectButton() {
		const bell = getBell();
		if (!bell?.parentElement) return;
		if (!document.getElementById(BTN_ID)) {
			const btn = makePillButton(BTN_ID, "+ Playlist", "Add tracks from unread new-release notifications", "#a238ff", run);
			bell.parentElement.insertBefore(btn, bell);
		}
		if (!document.getElementById(BTN_ID + "-debug")) {
			const dbg = makePillButton(
				BTN_ID + "-debug",
				"🔍 Unread",
				"Show which items the script considers unread (no changes)",
				"#444",
				debugMarkUnread,
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
