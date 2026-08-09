import { EMBED_TAGS } from "../config/constants.js";
import { resolveElementStyling } from "./element-styles.js";
import { createFormBuilder } from "./form.js";
import { newId } from "./ids.js";
import { createElementNode, createEmbedNode, createTextNode, mapNodeType } from "./nodes.js";

/**
 * Walks a parsed DOM and flattens it into the payload's `nodes` array.
 *
 * @param {object} deps
 * @param {object[]} deps.nodes  flat node list, appended to in place
 * @param {ReturnType<import("./style-registry.js").createStyleRegistry>} deps.styles
 * @param {{ nativeForms?: boolean }} [deps.options]
 * @param {Map<Node, string>} [deps.sheetLeftovers]  per-<style> CSS that could NOT be turned
 *   into native Webflow styles and therefore still needs a Code Embed
 * @returns {(node: Node) => string|null} traverse - returns the new node's id, or null if the
 *   node produced nothing (whitespace, a comment, an empty image, a consumed label, a <style>
 *   whose rules all became native styles).
 */
export const createTraverser = ({ nodes, styles, options = {}, sheetLeftovers = new Map() }) => {
	// Labels swallowed into a checkbox/radio wrapper must not be emitted again by the walk.
	const consumed = new WeakSet();
	// The <form> currently being converted, so a control can look up its label within it.
	let formScope = null;

	const form = createFormBuilder({
		nodes,
		styles,
		consumed,
		traverseChild: (child) => traverse(child, true),
	});

	const traverse = (node, insideForm = false) => {
		if (node.nodeType === Node.TEXT_NODE) {
			// Collapse whitespace runs the way HTML rendering does, but KEEP the single space
			// BETWEEN siblings. Trimming everything glues words to their neighbouring
			// <strong>/<em>/<a> ("This paragraph hasbold textand...").
			let text = node.textContent.replace(/\s+/g, " ");
			if (!text.trim()) return null; // pure whitespace contributes nothing

			// A space at the very start or end of an element's content is not rendered, so drop
			// it there - `<div> Inner Text </div>` is "Inner Text", not " Inner Text ".
			if (!node.previousSibling) text = text.replace(/^ /, "");
			if (!node.nextSibling) text = text.replace(/ $/, "");

			const id = newId();
			nodes.push(createTextNode(id, text));
			return id;
		}

		// Comments, doctypes, processing instructions.
		if (node.nodeType !== Node.ELEMENT_NODE) return null;

		// An image with no src would paste as Webflow's placeholder, so skip it entirely.
		if (node.tagName === "IMG" && !node.getAttribute("src")?.trim()) return null;

		// <style>/<script>/<link> become a Code Embed carrying their source verbatim. Returns
		// before the child walk so the CSS/JS text isn't emitted as a text node.
		if (EMBED_TAGS.includes(node.tagName)) {
			// Rules that became native Webflow styles are stripped from the embed. If the whole
			// block was adopted there is nothing left to embed, so drop the element entirely.
			if (node.tagName === "STYLE" && sheetLeftovers.has(node)) {
				const leftover = sheetLeftovers.get(node).trim();
				if (!leftover) return null;

				// Rebuild from a shallow clone so any attributes (media, nonce) survive.
				const skeleton = node.cloneNode(false);
				skeleton.textContent = `\n${leftover}\n`;
				const embedId = newId();
				nodes.push(createEmbedNode(embedId, node, skeleton.outerHTML));
				return embedId;
			}

			const embedId = newId();
			nodes.push(createEmbedNode(embedId, node));
			return embedId;
		}

		// A <form> becomes a real Webflow form when the feature is on. Nested forms are invalid
		// HTML anyway, so only the outermost one takes this path.
		if (options.nativeForms && node.tagName === "FORM" && !insideForm) {
			const previousScope = formScope;
			formScope = node;
			try {
				return form.buildForm(node);
			} finally {
				formScope = previousScope;
			}
		}

		// Form controls convert to native Webflow field elements. This deliberately does NOT
		// require an enclosing <form>: Webflow is happy to hold a lone Text Field, and a snippet
		// containing just an <input> is a normal thing to convert. `undefined` means "not a
		// control" and falls through to the generic element path below.
		//
		// Label lookup falls back to the whole document when there is no form to scope it to.
		if (options.nativeForms) {
			const controlId = form.tryBuildControl(node, formScope ?? node.ownerDocument);
			if (controlId !== undefined) return controlId;
		}

		const id = newId();
		const wfType = mapNodeType(node.tagName);
		const { classIds, otherClasses } = resolveElementStyling(node, styles);

		const wfNode = createElementNode(id, node, wfType, classIds, otherClasses);

		// Push the parent FIRST so it appears before its children in the flat array.
		nodes.push(wfNode);

		Array.from(node.childNodes).forEach((child) => {
			const childId = traverse(child, insideForm);
			if (childId) wfNode.children.push(childId);
		});

		return id;
	};

	return traverse;
};
