import { COPIED_FEEDBACK_MS } from "../config/constants.js";

/**
 * Everything that writes to the page. The controller decides what happened; the view decides
 * how it looks.
 */

const IDLE_BTN_CLASSES = ["bg-slate-800", "text-slate-300", "border-slate-600"];
const COPIED_BTN_CLASSES = ["bg-emerald-500/20", "text-emerald-400", "border-emerald-500/50"];

export const createView = (els) => {
	let copiedTimer;

	const showOutput = (text, { canCopy }) => {
		els.errorState.classList.add("hidden");
		els.jsonOutput.classList.remove("hidden");
		els.jsonOutput.textContent = text;
		els.copyBtn.disabled = !canCopy;
	};

	return {
		/** Nothing to convert yet. */
		renderEmpty() {
			showOutput("// Waiting for HTML input...", { canCopy: false });
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
		},

		/** Flip the Copy button into its confirmation state, then back. */
		flashCopied() {
			clearTimeout(copiedTimer);

			els.copyBtn.classList.remove(...IDLE_BTN_CLASSES);
			els.copyBtn.classList.add(...COPIED_BTN_CLASSES);
			els.iconCopy.classList.add("hidden");
			els.iconCheck.classList.remove("hidden");
			els.copyText.textContent = "Copied JSON";

			copiedTimer = setTimeout(() => {
				els.copyBtn.classList.add(...IDLE_BTN_CLASSES);
				els.copyBtn.classList.remove(...COPIED_BTN_CLASSES);
				els.iconCheck.classList.add("hidden");
				els.iconCopy.classList.remove("hidden");
				els.copyText.textContent = "Copy JSON";
			}, COPIED_FEEDBACK_MS);
		},
	};
};
