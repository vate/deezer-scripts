// ==UserScript==
// @name         Deezer: Bulk Remove Above
// @namespace    https://github.com/vate/deezer-scripts
// @version      1.0.2
// @description  Adds a hover button on playlist rows that removes the hovered track plus every track above it.
// @author       Andrés Ortiz Massó
// @license      GPL-3.0
// @homepageURL  https://github.com/vate/deezer-scripts
// @supportURL   https://github.com/vate/deezer-scripts/issues
// @downloadURL  https://raw.githubusercontent.com/vate/deezer-scripts/main/bulk-remove/deezer-scripts-bulk-remove.user.js
// @updateURL    https://raw.githubusercontent.com/vate/deezer-scripts/main/bulk-remove/deezer-scripts-bulk-remove.user.js
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
		// Confirm dialog is skipped when N <= confirmThreshold. 0 = always confirm.
		confirmThreshold: 0,
		fetchPageSize: 2000,
	};
	const BTN_ID = "dz-bulk-remove-btn";
	const PLAYLIST_RE = /\/playlist\/(\d+)/;

	const gmGet = typeof GM_getValue === "function" ? GM_getValue : () => undefined;
	const gmSet = typeof GM_setValue === "function" ? GM_setValue : () => {};
	function cfg(key) {
		const stored = gmGet(key, undefined);
		return stored !== undefined && stored !== "" ? stored : CONFIG[key];
	}

	if (typeof GM_registerMenuCommand === "function") {
		GM_registerMenuCommand("Set confirm threshold…", () => {
			const current = cfg("confirmThreshold");
			const v = prompt("Skip confirm when removing N or fewer tracks (0 = always confirm):", String(current));
			if (v === null) return;
			const n = parseInt(v.trim(), 10);
			gmSet("confirmThreshold", Number.isFinite(n) && n >= 0 ? n : 0);
		});
	}

	const GW = "/ajax/gw-light.php";
	// Deezer GW quirks learned the hard way:
	// - playlist.getSongs returns an empty list (no error) when called without a
	//   valid api_token. Always fetch the token via deezer.getUserData first.
	// - playlist.deleteSongs rejects with "Invalid CSRF token" unless the request
	//   also carries a `cid` query param (random per call) AND an `x-deezer-user`
	//   header set to USER.USER_ID from deezer.getUserData. Body keys are
	//   lowercase (playlist_id, songs, ctxt) and song IDs must be numbers, not
	//   strings — playlist.addSongs is more forgiving and accepts uppercase keys
	//   + string IDs, so don't copy that shape blindly.
	const newCid = () => String(Math.floor(Math.random() * 1e9));

	async function gwCall(method, body, apiToken = "", userId = "") {
		const url = `${GW}?api_version=1.0&api_token=${encodeURIComponent(apiToken)}&input=3&method=${method}&cid=${newCid()}`;
		const headers = { "Content-Type": "application/json" };
		if (userId) headers["x-deezer-user"] = String(userId);
		const res = await fetch(url, { method: "POST", credentials: "include", headers, body: JSON.stringify(body || {}) });
		if (!res.ok) throw new Error(`GW ${method} HTTP ${res.status}`);
		return res.json();
	}
	async function getUserAuth() {
		const data = await gwCall("deezer.getUserData", {});
		return { apiToken: data?.results?.checkForm, userId: data?.results?.USER?.USER_ID };
	}
	async function getAllPlaylistSongs(playlistId, apiToken, userId) {
		const all = [];
		const pageSize = cfg("fetchPageSize");
		let start = 0;
		let total = Infinity;
		while (start < total) {
			const j = await gwCall(
				"playlist.getSongs",
				{ playlist_id: String(playlistId), nb: pageSize, start },
				apiToken,
				userId,
			);
			const data = j?.results?.data || [];
			total = j?.results?.total ?? data.length;
			if (!data.length) break;
			all.push(...data);
			start += data.length;
		}
		return all;
	}
	async function deletePlaylistSongs(playlistId, trackIds, apiToken, userId) {
		return gwCall(
			"playlist.deleteSongs",
			{
				playlist_id: String(playlistId),
				songs: trackIds.map((id) => [Number(id), 0]),
				ctxt: { id: Number(playlistId), t: "playlist_page" },
			},
			apiToken,
			userId,
		);
	}

	function currentPlaylistId() {
		const m = location.pathname.match(PLAYLIST_RE);
		return m ? m[1] : null;
	}
	function playlistName() {
		return document.querySelector("h1")?.textContent?.trim() || "this playlist";
	}

	function rowIdentity(row) {
		if (!row) return null;
		const title = row.querySelector('[data-testid="title"]')?.textContent?.trim() || "";
		const album = row.querySelector('a[data-testid="album"]')?.getAttribute("href") || "";
		const albumId = album.match(/\/album\/(\d+)/)?.[1] || "";
		if (!title || !albumId) return null;
		return { title, albumId };
	}
	function findSongIndex(songs, ident) {
		// Match on (title + album). Title alone collides on covers/reissues; adding
		// album disambiguates. Artist ID isn't a reliable extra filter: the DOM's
		// first artist link can be a featured artist on a collab while ART_ID is the
		// album's primary artist.
		return songs.findIndex((s) => s.SNG_TITLE === ident.title && String(s.ALB_ID) === ident.albumId);
	}

	// ---- UI -------------------------------------------------------------------
	let pillBtn = null;
	let hoveredRow = null;
	let pinned = false; // true while the cursor is over the pill itself

	function toast(msg, isError) {
		const n = document.createElement("div");
		n.textContent = msg;
		n.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:99999;padding:10px 14px;border-radius:6px;font:600 13px/1.3 system-ui,sans-serif;background:${isError ? "#a02020" : "#1f8a3b"};color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.45);max-width:380px`;
		document.body.appendChild(n);
		setTimeout(() => n.remove(), 5000);
	}

	function ensurePill() {
		if (pillBtn) return pillBtn;
		pillBtn = document.createElement("button");
		pillBtn.id = BTN_ID;
		pillBtn.type = "button";
		pillBtn.textContent = "↥ Remove this & above";
		pillBtn.title = "Remove the hovered track plus every track above it in this playlist";
		pillBtn.style.cssText = `position:fixed;display:none;z-index:99998;padding:5px 10px;background:#d6336c;color:#fff;border:0;border-radius:999px;font:600 11px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.45)`;
		pillBtn.addEventListener("mouseenter", () => {
			pinned = true;
		});
		pillBtn.addEventListener("mouseleave", () => {
			pinned = false;
			hidePill();
		});
		pillBtn.addEventListener("click", onPillClick);
		document.body.appendChild(pillBtn);
		return pillBtn;
	}

	function showPillFor(row) {
		hoveredRow = row;
		const btn = ensurePill();
		const rect = row.getBoundingClientRect();
		btn.style.display = "block";
		// Anchor to the left edge of the last cell (the selection checkbox) so the
		// pill never covers it. Fall back to the row's right edge if the cell layout
		// changes.
		const cells = row.querySelectorAll('[role="gridcell"]');
		const checkboxCell = cells[cells.length - 1];
		const rightAnchor = checkboxCell ? checkboxCell.getBoundingClientRect().left : rect.right;
		const top = rect.top + rect.height / 2 - btn.offsetHeight / 2;
		const left = rightAnchor - btn.offsetWidth - 8;
		btn.style.top = `${Math.max(0, top)}px`;
		btn.style.left = `${Math.max(0, left)}px`;
	}
	function hidePill() {
		if (pinned) return;
		hoveredRow = null;
		if (pillBtn) pillBtn.style.display = "none";
	}

	function onRowMouseEnter(e) {
		if (!currentPlaylistId()) return;
		const row = e.target.closest('[role="row"][aria-rowindex]');
		if (!row) return;
		// Skip the header row (no title cell).
		if (!row.querySelector('[data-testid="title"]')) return;
		// Only the FIRST grid on a playlist page is the playlist itself — later grids
		// ("Recommended" / "Made for you") are separate and not in playlist.getSongs.
		const playlistGrid = document.querySelector('[role="grid"]');
		if (!playlistGrid?.contains(row)) return;
		showPillFor(row);
	}
	function onMouseMove(e) {
		if (!pillBtn || pillBtn.style.display === "none") return;
		if (pinned) return;
		const overRow = hoveredRow && hoveredRow.contains(e.target);
		const overPill = pillBtn.contains(e.target);
		if (!overRow && !overPill) hidePill();
	}

	async function onPillClick() {
		const row = hoveredRow;
		const playlistId = currentPlaylistId();
		if (!row || !playlistId) return;
		const ident = rowIdentity(row);
		if (!ident) return toast("Could not read track info from row", true);

		const originalLabel = pillBtn.textContent;
		pillBtn.disabled = true;
		pillBtn.textContent = "…working";

		try {
			const { apiToken, userId } = await getUserAuth();
			if (!apiToken) return toast("Could not fetch Deezer API token", true);

			const songs = await getAllPlaylistSongs(playlistId, apiToken, userId);
			if (!songs.length) return toast("Playlist is empty", true);

			const idx = findSongIndex(songs, ident);
			if (idx === -1) return toast(`Could not match "${ident.title}" in playlist`, true);

			const toRemove = songs.slice(0, idx + 1);
			const n = toRemove.length;
			const threshold = Number(cfg("confirmThreshold")) || 0;
			if (n > threshold) {
				const ok = confirm(`Remove ${n} track(s) (this one and everything above) from "${playlistName()}"?`);
				if (!ok) return;
			}

			const trackIds = toRemove.map((s) => s.SNG_ID);
			const r = await deletePlaylistSongs(playlistId, trackIds, apiToken, userId);
			if (r?.error && Object.keys(r.error).length) {
				toast(`Delete failed: ${JSON.stringify(r.error).slice(0, 200)}`, true);
				return;
			}
			toast(`Removed ${n} track(s) from "${playlistName()}" — reloading`);
			setTimeout(() => location.reload(), 800);
		} catch (e) {
			console.error("[dz-bulk-remove]", e);
			toast("Error: " + (e?.message || e), true);
		} finally {
			if (pillBtn) {
				pillBtn.disabled = false;
				pillBtn.textContent = originalLabel;
			}
		}
	}

	document.addEventListener("mouseover", onRowMouseEnter, true);
	document.addEventListener("mousemove", onMouseMove, true);
	// Hide the pill on scroll/route changes so it doesn't float over the wrong row.
	window.addEventListener("scroll", () => !pinned && hidePill(), true);
	window.addEventListener("popstate", () => hidePill());
})();
