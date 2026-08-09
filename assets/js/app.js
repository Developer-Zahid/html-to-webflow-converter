import { DEFAULT_HTML } from "./config/default-html.js";
import { INPUT_DEBOUNCE_MS } from "./config/constants.js";
import { convertHtmlToWebflow } from "./converter/index.js";
import { copyAsWebflowJson } from "./ui/clipboard.js";
import { getElements } from "./ui/elements.js";
import { createView } from "./ui/view.js";

/**
 * Controller. Owns the app's state and wires the input, the conversion engine, and the clipboard
 * together. Neither the converter nor the view knows the other exists.
 */
export const initApp = () => {
	const els = getElements();
	const view = createView(els);

	/** Latest successful conversion, stringified. "" while empty or errored. */
	let currentJson = "";

	const convert = () => {
		const html = els.htmlInput.value;

		if (!html.trim()) {
			currentJson = "";
			view.renderEmpty();
			return;
		}

		try {
			const payload = convertHtmlToWebflow(html, {
				nativeForms: els.nativeFormsToggle.checked,
				mergeEmbeds: els.mergeEmbedsToggle.checked,
			});
			currentJson = JSON.stringify(payload, null, 2);
			view.renderJson(currentJson);
		} catch (err) {
			console.error(err);
			currentJson = "";
			view.renderError("Failed to parse HTML. Please ensure it is valid.");
		}
	};

	let debounceTimer;
	els.htmlInput.addEventListener("input", () => {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(convert, INPUT_DEBOUNCE_MS);
	});

	// Flipping a conversion option re-runs immediately - there is nothing to debounce.
	els.nativeFormsToggle.addEventListener("change", convert);
	els.mergeEmbedsToggle.addEventListener("change", convert);

	// Must stay inside the click handler - the copy is only permitted during a user gesture.
	els.copyBtn.addEventListener("click", () => {
		if (!currentJson) return;
		if (copyAsWebflowJson(currentJson)) view.flashCopied();
	});

	els.htmlInput.value = DEFAULT_HTML;
	convert();
};
