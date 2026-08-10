import { COPIED_FEEDBACK_MS } from "../config/constants.js";

/**
 * Everything that writes to the page. The controller decides what happened; the view decides
 * how it looks.
 */

// These must stay in step with the same classes written in index.html - the swap below removes
// the idle set literally. Colour names come from the palette defined there.
const IDLE_BTN_CLASSES = [ "text-slate-300", "border-line"];
const COPIED_BTN_CLASSES = ["bg-emerald-500/20", "text-emerald-400", "border-emerald-500/50"];

const TAB_ACTIVE_CLASSES = ["bg-elevated", "text-white"];
const TAB_IDLE_CLASSES = ["text-slate-400"];

export const createView = (els) => {
	let copiedTimer;
	let convertedTimer;

	const tabs = {
		html: { button: els.tabHtml, panel: els.htmlInput },
		css: { button: els.tabCss, panel: els.cssInput },
		js: { button: els.tabJs, panel: els.jsInput },
	};

	const showOutput = (text, { canCopy }) => {
		els.errorState.classList.add("hidden");
		els.jsonOutput.classList.remove("hidden");
		els.jsonOutput.textContent = text;
		els.copyBtn.disabled = !canCopy;
		els.convertBtn.disabled = !canCopy;
	};

	return {
		/** @param {"html"|"css"|"js"} name  bring one editor pane to the front */
		showTab(name) {
			for (const [key, { button, panel }] of Object.entries(tabs)) {
				const active = key === name;
				panel.classList.toggle("hidden", !active);
				button.classList.remove(...(active ? TAB_IDLE_CLASSES : TAB_ACTIVE_CLASSES));
				button.classList.add(...(active ? TAB_ACTIVE_CLASSES : TAB_IDLE_CLASSES));
				button.setAttribute("aria-selected", String(active));
			}
			tabs[name].panel.focus();
		},

		/** Nothing to convert yet. */
		renderEmpty() {
			showOutput("// Waiting for input...", { canCopy: false });
		},

		/** @param {string} json  pretty-printed payload */
		renderJson(json) {
			showOutput(json, { canCopy: true });
		},

		/** @param {string} message  human-readable, not the raw exception */
		renderError(message) {
			els.jsonOutput.classList.add("hidden");
			els.errorState.classList.remove("hidden");
			els.errorMessage.textContent = message;
			els.copyBtn.disabled = true;
			els.convertBtn.disabled = true;
		},

		/** Flip the Copy button into its confirmation state, then back. */
		flashCopied() {
			clearTimeout(copiedTimer);

			els.copyBtn.classList.remove(...IDLE_BTN_CLASSES);
			els.copyBtn.classList.add(...COPIED_BTN_CLASSES);
			els.iconCopy.classList.add("hidden");
			els.iconCheck.classList.remove("hidden");
			els.copyText.textContent = "Copied";

			copiedTimer = setTimeout(() => {
				els.copyBtn.classList.add(...IDLE_BTN_CLASSES);
				els.copyBtn.classList.remove(...COPIED_BTN_CLASSES);
				els.iconCheck.classList.add("hidden");
				els.iconCopy.classList.remove("hidden");
				els.copyText.textContent = "Copy";
			}, COPIED_FEEDBACK_MS);
		},

		/** Confirmation on the big Convert button - the payload is on the clipboard. */
		flashConverted() {
			clearTimeout(convertedTimer);
			els.convertText.textContent = "Copied! Paste into Webflow";
			convertedTimer = setTimeout(() => {
				els.convertText.textContent = "Convert to Webflow";
			}, COPIED_FEEDBACK_MS);
		},
	};
};
