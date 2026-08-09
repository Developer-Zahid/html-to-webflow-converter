import { initApp } from "./app.js";

/**
 * Entry point. Loaded with <script type="module">, which is deferred by default, so the DOM is
 * normally parsed by the time this runs - the readyState check is just belt and braces.
 */
if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", initApp, { once: true });
} else {
	initApp();
}
