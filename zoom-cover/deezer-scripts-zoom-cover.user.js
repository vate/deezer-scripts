// ==UserScript==
// @name         Deezer: Zoom Cover on Click
// @namespace    https://github.com/vate/deezer-scripts
// @version      1.0.0
// @description  Click an album cover to open it full-size in a lightbox — the same "Zoom on the Cover" the ⋯ menu offers, but one click away.
// @author       Andrés Ortiz Massó
// @license      GPL-3.0
// @homepageURL  https://github.com/vate/deezer-scripts
// @supportURL   https://github.com/vate/deezer-scripts/issues
// @downloadURL  https://raw.githubusercontent.com/vate/deezer-scripts/main/zoom-cover/deezer-scripts-zoom-cover.user.js
// @updateURL    https://raw.githubusercontent.com/vate/deezer-scripts/main/zoom-cover/deezer-scripts-zoom-cover.user.js
// @match        https://www.deezer.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=deezer.com
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
	"use strict";

	// The album masthead cover lives in [data-testid="album-cover"]; its <img>
	// src looks like .../images/cover/<hash>/500x500-000000-80-0-0.jpg. Swapping
	// the WxH token for a large size makes the CDN serve the highest resolution it
	// has (it caps to the source, so over-asking is safe).
	const COVER_SEL = '[data-testid="album-cover"]';
	const SIZE_RE = /\/\d+x\d+-/;
	const ZOOM_SIZE = "1500x1500";
	const OVERLAY_ID = "dz-zoom-cover-overlay";

	function highResUrl(img) {
		const src = img?.currentSrc || img?.src || "";
		if (!/images\/cover\//.test(src)) return src;
		return SIZE_RE.test(src) ? src.replace(SIZE_RE, `/${ZOOM_SIZE}-`) : src;
	}

	function closeOverlay() {
		document.getElementById(OVERLAY_ID)?.remove();
		document.removeEventListener("keydown", onKeydown, true);
	}

	function onKeydown(e) {
		if (e.key === "Escape") {
			e.preventDefault();
			closeOverlay();
		}
	}

	function openOverlay(url) {
		closeOverlay();

		const overlay = document.createElement("div");
		overlay.id = OVERLAY_ID;
		overlay.style.cssText =
			"position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;" +
			"background:rgba(0,0,0,.85);cursor:zoom-out;backdrop-filter:blur(4px)";

		const img = document.createElement("img");
		img.src = url;
		img.alt = "Album cover";
		img.style.cssText =
			"max-width:90vw;max-height:90vh;box-shadow:0 8px 40px rgba(0,0,0,.6);border-radius:6px;" +
			"object-fit:contain";

		overlay.appendChild(img);
		overlay.addEventListener("click", closeOverlay);
		document.body.appendChild(overlay);
		document.addEventListener("keydown", onKeydown, true);
	}

	// Delegate so it keeps working as Deezer re-renders the masthead on navigation.
	document.addEventListener(
		"click",
		(e) => {
			const cover = e.target.closest?.(COVER_SEL);
			if (!cover) return;
			const img = cover.querySelector("img");
			const url = highResUrl(img);
			if (!url) return;
			// Don't let the cover's own click handler (play / nothing) also fire.
			e.preventDefault();
			e.stopPropagation();
			openOverlay(url);
		},
		true,
	);

	// Hint that the cover is clickable.
	const style = document.createElement("style");
	style.textContent = `${COVER_SEL}{cursor:zoom-in}`;
	document.head.appendChild(style);
})();
