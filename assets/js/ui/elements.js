/**
 * Single place where the app reaches into the page's markup. If an id changes in index.html,
 * this is the only file that needs to know.
 */

const IDS = {
	htmlInput: "html-input",
	nativeFormsToggle: "native-forms-toggle",
	jsonOutput: "json-output",
	errorState: "error-state",
	errorMessage: "error-message",
	copyBtn: "copy-btn",
	copyText: "copy-text",
	iconCopy: "icon-copy",
	iconCheck: "icon-check",
};

/**
 * @returns {Record<keyof typeof IDS, HTMLElement>}
 * @throws {Error} if the markup and this map have drifted apart
 */
export const getElements = () => {
	const found = {};
	const missing = [];

	for (const [key, id] of Object.entries(IDS)) {
		const el = document.getElementById(id);
		if (el) found[key] = el;
		else missing.push(id);
	}

	if (missing.length) {
		throw new Error(`Missing required element(s) in the page: #${missing.join(", #")}`);
	}

	return found;
};
