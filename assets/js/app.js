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

	/**
	 * The three tabs are one document. CSS goes ahead of the markup in a <style> - where a
	 * document's <head> styles live - and JS after it in a <script>, where authors put code that
	 * expects the DOM to exist. The converter then treats them exactly like tags that had been
	 * written into the HTML itself.
	 */
	const combinedHtml = () => {
		const css = els.cssInput.value.trim();
		const js = els.jsInput.value.trim();

		const parts = [];
		if (css) parts.push(`<style>\n${css}\n</style>`);
		if (els.htmlInput.value.trim()) parts.push(els.htmlInput.value);
		if (js) parts.push(`<script>\n${js}\n</script>`);
		return parts.join("\n");
	};

	const convert = () => {
		const html = combinedHtml();

		if (!html.trim()) {
			currentJson = "";
			view.renderEmpty();
			return;
		}

		try {
			const payload = convertHtmlToWebflow(html, {
				nativeForms: els.nativeFormsToggle.checked,
				nativeImages: els.nativeImagesToggle.checked,
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
	const convertSoon = () => {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(convert, INPUT_DEBOUNCE_MS);
	};
	els.htmlInput.addEventListener("input", convertSoon);
	els.cssInput.addEventListener("input", convertSoon);
	els.jsInput.addEventListener("input", convertSoon);

	// Flipping a conversion option re-runs immediately - there is nothing to debounce.
	els.nativeFormsToggle.addEventListener("change", convert);
	els.nativeImagesToggle.addEventListener("change", convert);
	els.mergeEmbedsToggle.addEventListener("change", convert);

	els.tabHtml.addEventListener("click", () => view.showTab("html"));
	els.tabCss.addEventListener("click", () => view.showTab("css"));
	els.tabJs.addEventListener("click", () => view.showTab("js"));

	// Must stay inside the click handler - the copy is only permitted during a user gesture.
	els.copyBtn.addEventListener("click", () => {
		if (!currentJson) return;
		if (copyAsWebflowJson(currentJson)) view.flashCopied();
	});

	// Convert-and-copy in one gesture, the way the sidebar copy describes it. The debounced
	// conversion may still be pending, so run it now rather than copying a stale payload.
	els.convertBtn.addEventListener("click", () => {
		clearTimeout(debounceTimer);
		convert();
		if (!currentJson) return;
		if (copyAsWebflowJson(currentJson)) view.flashConverted();
	});

	els.clearBtn.addEventListener("click", () => {
		clearTimeout(debounceTimer);
		els.htmlInput.value = "";
		els.cssInput.value = "";
		els.jsInput.value = "";
		convert();
	});

	els.htmlInput.value = DEFAULT_HTML;
	view.showTab("html");
	convert();
};
