import { EMBED_TAGS, FALLBACK_NODE_TYPE } from "../config/constants.js";
import { resolveElementStyling } from "./element-styles.js";
import { createFormBuilder } from "./form.js";
import { newId } from "./ids.js";
import { resolveImage } from "./images.js";
import { carriesText, groupInlineRuns, hasBlockChild, relaxLinksInTextFlow } from "./inline-runs.js";
import { createElementNode, createEmbedNode, createTextBlockNode, createTextNode, mapNodeType } from "./nodes.js";

/**
 * Walks a parsed DOM and flattens it into the payload's `nodes` array.
 *
 * @param {object} deps
 * @param {object[]} deps.nodes  flat node list, appended to in place
 * @param {ReturnType<import("./style-registry.js").createStyleRegistry>} deps.styles
 * @param {{ nativeForms?: boolean }} [deps.options]
 * @param {Map<Node, string>} [deps.sheetLeftovers]  per-<style> CSS that could NOT be turned
 *   into native Webflow styles and therefore still needs a Code Embed
 * @param {ReturnType<import("./embed-merge.js").createEmbedCollector>} [deps.embedCollector]
 *   when present, code tags are handed to it instead of becoming an embed where they sit
 * @returns {(node: Node) => string|null} traverse - returns the new node's id, or null if the
 *   node produced nothing (whitespace, a comment, an empty image, a consumed label, a <style>
 *   whose rules all became native styles, a code tag claimed by the collector).
 */
/**
 * Whether a code tag carries anything Webflow could publish.
 *
 * An empty <style></style> or <script></script> renders nothing, but it still pastes as a real
 * Code Embed that clutters the Navigator and has to be deleted by hand.
 *
 * External references must NOT be caught by this - they are empty BY NATURE and carry their
 * payload in an attribute instead: a <script src> and a <link href> are the whole point of those
 * tags. Attributes alone are not enough either, though: a <style media="print"></style> with no
 * rules still does nothing.
 *
 * Emptiness is measured with innerHTML rather than textContent because <noscript> holds MARKUP -
 * `<noscript><img src="x.gif"></noscript>` has no text at all but is not empty. For <style> and
 * <script>, which are raw-text elements, the two are the same string.
 */
const carriesCode = (element) => {
	if (element.tagName === "SCRIPT" && element.getAttribute("src")?.trim()) return true;
	if (element.tagName === "LINK") return Boolean(element.getAttribute("href")?.trim());
	return Boolean(element.innerHTML?.trim());
};

export const createTraverser = ({ nodes, styles, options = {}, sheetLeftovers = new Map(), embedCollector = null }) => {
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

	/**
	 * Wrap one run of loose text in a text-type Div Block.
	 * @returns {string|null} the block's id, or null when the run produced nothing
	 */
	const buildTextBlock = (run, insideForm) => {
		const blockId = newId();
		const block = createTextBlockNode(blockId);
		nodes.push(block); // parent before children, same as the element walk

		run.forEach((child) => {
			const childId = traverse(child, insideForm);
			if (childId) block.children.push(childId);
		});

		if (block.children.length === 0) {
			nodes.pop();
			return null;
		}
		relaxLinksInTextFlow(nodes, block.children);
		return blockId;
	};

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
			// Nothing to publish - skip it rather than paste an empty Code Embed.
			if (!carriesCode(node)) return null;

			// Rules that became native Webflow styles are stripped from the embed. If the whole
			// block was adopted there is nothing left to embed, so drop the element entirely.
			let source = node;
			if (node.tagName === "STYLE" && sheetLeftovers.has(node)) {
				const leftover = sheetLeftovers.get(node).trim();
				if (!leftover) return null;

				// Rebuild from a shallow clone so any attributes (media, nonce) survive.
				source = node.cloneNode(false);
				source.textContent = `\n${leftover}\n`;
			}

			// Merging is on and this tag is CSS or JS: it contributes to one of the two shared
			// embeds that get appended once the walk is done, and emits no node of its own.
			if (embedCollector?.accepts(node.tagName)) {
				embedCollector.add(node.tagName, source);
				return null;
			}

			const embedId = newId();
			nodes.push(createEmbedNode(embedId, node, source));
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
		let element = node;
		let wfType = mapNodeType(node.tagName);

		// An <img> is native or not depending on its SRC, not just its tag - see images.js. A
		// substituted src is written onto a shallow clone so the parsed document stays untouched.
		if (node.tagName === "IMG") {
			const image = resolveImage(node, options);
			wfType = image.native ? "Image" : FALLBACK_NODE_TYPE;
			if (image.src !== node.getAttribute("src")) {
				element = node.cloneNode(false);
				element.setAttribute("src", image.src);
			}
		}

		const { classIds, otherClasses } = resolveElementStyling(element, styles);

		const wfNode = createElementNode(id, element, wfType, classIds, otherClasses);

		// Push the parent FIRST so it appears before its children in the flat array.
		nodes.push(wfNode);

		const sourceChildren = Array.from(node.childNodes);

		// `data.text` marks an element whose content is a TEXT FLOW - it is what puts the "Text"
		// field in a Div Block's Settings panel and makes the Navigator label it with its own
		// words instead of "Div Block".
		//
		// Inline children do NOT break it: Webflow's own payload for a div reading
		// "This is some text inside of a div block." carries text:true while holding <code>,
		// <em>, <sup>, <strong>, <span> and <a> children. Only a BLOCK-level child makes the
		// element a container again. Requiring at least one direct text node is the conservative
		// half of the rule - a div holding nothing but a <span> is not covered by that payload.
		if (!hasBlockChild(sourceChildren) && carriesText(sourceChildren)) {
			sourceChildren.forEach((child) => {
				const childId = traverse(child, insideForm);
				if (childId) wfNode.children.push(childId);
			});
			wfNode.data.text = true;
			relaxLinksInTextFlow(nodes, wfNode.children);
			return id;
		}

		// A container. Text loose among block siblings cannot stay a direct child - the container
		// publishes elements, and a text node is not one - so each run of it gets its own
		// text-type Div Block.
		groupInlineRuns(sourceChildren).forEach((group) => {
			if (group.inline && carriesText(group.nodes)) {
				const textBlockId = buildTextBlock(group.nodes, insideForm);
				if (textBlockId) wfNode.children.push(textBlockId);
				return;
			}
			group.nodes.forEach((child) => {
				const childId = traverse(child, insideForm);
				if (childId) wfNode.children.push(childId);
			});
		});

		return id;
	};

	return traverse;
};
