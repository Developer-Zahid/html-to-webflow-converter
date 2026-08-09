/**
 * Clipboard writing.
 *
 * Webflow's paste handler reads the `application/json` clipboard flavour. The async Clipboard API
 * refuses that MIME type, so the only way to produce it is to hijack a real `copy` event - which
 * means this must be called from inside a user gesture (a click handler), or the browser will
 * refuse the copy.
 */

/**
 * @param {string} json  the payload, already stringified
 * @returns {boolean} whether the browser accepted the copy
 */
export const copyAsWebflowJson = (json) => {
	const onCopy = (event) => {
		event.clipboardData.setData("application/json", json);
		event.clipboardData.setData("text/plain", json); // fallback, and handy for inspection
		event.preventDefault(); // suppress the default "copy the selection" behaviour
	};

	document.addEventListener("copy", onCopy);

	// execCommand("copy") is a no-op without a selection, so give it a throwaway one.
	const dummy = document.createElement("span");
	dummy.textContent = "wf-copy";
	document.body.appendChild(dummy);

	const selection = window.getSelection();
	const range = document.createRange();
	range.selectNodeContents(dummy);
	selection.removeAllRanges();
	selection.addRange(range);

	let copied = false;
	try {
		copied = document.execCommand("copy");
	} catch (err) {
		console.error("Clipboard injection failed", err);
	} finally {
		selection.removeAllRanges();
		dummy.remove();
		document.removeEventListener("copy", onCopy);
	}

	return copied;
};
