import { EMBED_TAGS } from "../config/constants.js";
import { normalizeClassName, splitClasses } from "./class-names.js";
import { createEmbedCollector } from "./embed-merge.js";
import { newId } from "./ids.js";
import { carriesText, groupInlineRuns, relaxLinksInTextFlow } from "./inline-runs.js";
import { createParagraphNode, createWrapperNode } from "./nodes.js";
import { collectStylesheets } from "./stylesheet.js";
import { createStyleRegistry } from "./style-registry.js";
import { createTraverser } from "./traverse.js";

/**
 * Public API of the conversion engine.
 *
 * Pure in, pure out: an HTML string goes in, a Webflow clipboard payload object comes out. It
 * touches no page DOM of its own (beyond the throwaway element the CSS expander uses) and knows
 * nothing about the UI, so it can be reused from a CLI, a test, or a browser extension.
 */

/** Wrap the payload's parts in the exact clipboard envelope Webflow expects. */
const createPayload = (nodes, styles) => ({
	type: "@webflow/XscpData",
	payload: {
		nodes,
		styles,
		assets: [],
		ix1: [],
		ix2: {
			interactions: [],
			events: [],
			actionLists: [],
		},
	},
	meta: {
		droppedLinks: 0,
		dynBindRemovedCount: 0,
		dynListBindRemovedCount: 0,
		paginationRemovedCount: 0,
		universalBindingsRemovedCount: 0,
		unlinkedSymbolCount: 0,
		codeComponentsRemovedCount: 0,
		richTextComponentsStripped: false,
	},
});

/**
 * Convert an HTML string into a `@webflow/XscpData` clipboard payload.
 *
 * @param {string} html
 * @param {object} [options]
 * @param {boolean} [options.nativeForms=false]  convert <form> and its fields into native
 *   Webflow form elements instead of Custom Elements
 * @param {boolean} [options.mergeEmbeds=false]  fold every <style>/<link> into one Code Embed and
 *   every <script> into another, instead of one embed per tag
 * @param {boolean} [options.nativeImages=false]  make EVERY <img> a native Webflow Image,
 *   substituting Webflow's placeholder for any src that would not survive publish. Off, EVERY
 *   <img> stays a Custom Element with its URL intact (see converter/images.js)
 * @returns {object} the payload, ready to be JSON.stringify'd onto the clipboard
 */
export const convertHtmlToWebflow = (html, options = {}) => {
	const doc = new DOMParser().parseFromString(html, "text/html");

	// Which class names will become real Webflow style blocks. Only the FIRST class on an element
	// gets one; the rest ride along as a passthrough `class` attribute, so a <style> rule
	// targeting one of those cannot be lifted into the Style panel and stays in the embed.
	const adoptableClasses = new Set();
	// `"<base> <combo>"` for every pair an element actually carries, so a `.a.b` rule is only
	// lifted out of the embed when there is something for it to attach to.
	const adoptableCombos = new Set();
	doc.querySelectorAll("[class]").forEach((el) => {
		const { mainClass, otherClasses } = splitClasses(el);
		if (!mainClass) return;
		adoptableClasses.add(mainClass);
		otherClasses.forEach((raw) => {
			const combo = normalizeClassName(raw);
			if (combo) adoptableCombos.add(`${mainClass} ${combo}`);
		});
	});

	const { rulesByClass, leftoverByElement } = collectStylesheets(Array.from(doc.querySelectorAll("style")), adoptableClasses, adoptableCombos);

	const nodes = [];
	const styles = createStyleRegistry({ sheetRules: rulesByClass });
	const embedCollector = options.mergeEmbeds ? createEmbedCollector() : null;
	const traverse = createTraverser({ nodes, styles, options, sheetLeftovers: leftoverByElement, embedCollector });

	const rootIds = [];
	const addRoot = (node) => {
		const rootId = traverse(node);
		if (rootId) rootIds.push(rootId);
	};

	// The HTML parser hoists a LEADING <style>/<script>/<link> into <head>, so a snippet that
	// starts with one would otherwise lose it entirely - body never sees it. Walk head first,
	// code tags only (<title>/<meta>/<base> are page settings, not content).
	Array.from(doc.head.childNodes)
		.filter((n) => n.nodeType === Node.ELEMENT_NODE && EMBED_TAGS.includes(n.tagName))
		.forEach(addRoot);

	/**
	 * A text node is a CHILD-only shape - no `type`, no `tag` - so it cannot be a root. Text
	 * written at the top level with no tag around it therefore needs a Paragraph, which is what
	 * that same text would be in a document. (Inside a container the equivalent wrapper is a
	 * text-type Div Block - see traverse.js.)
	 *
	 * Whole RUNS are wrapped rather than each text node on its own, so `Some <a>link</a> text`
	 * stays one paragraph instead of splitting into three siblings.
	 */
	const addParagraphRun = (run) => {
		const paragraphId = newId();
		const paragraph = createParagraphNode(paragraphId, []);
		nodes.push(paragraph); // parent before children, matching the element walk
		run.forEach((node) => {
			const childId = traverse(node);
			if (childId) paragraph.children.push(childId);
		});

		if (paragraph.children.length === 0) {
			nodes.pop(); // everything in the run evaporated - drop the empty paragraph
			return;
		}
		relaxLinksInTextFlow(nodes, paragraph.children);
		rootIds.push(paragraphId);
	};

	groupInlineRuns(Array.from(doc.body.childNodes)).forEach((group) => {
		// A run with no actual text is just elements that happen to be inline: a lone <a> or
		// <strong> is a perfectly good root already and does not want a paragraph around it.
		if (group.inline && carriesText(group.nodes)) addParagraphRun(group.nodes);
		else group.nodes.forEach(addRoot);
	});

	// The merged embeds are built only once every code tag has been seen. They bracket the
	// content the way a document does - styles ahead of what they style, scripts after the markup
	// they act on, which is where the author's own <script> tags almost always were.
	if (embedCollector) {
		const { cssNode, jsNode } = embedCollector.toNodes();
		if (cssNode) {
			nodes.push(cssNode);
			rootIds.unshift(cssNode._id);
		}
		if (jsNode) {
			nodes.push(jsNode);
			rootIds.push(jsNode._id);
		}
	}

	// Webflow's cross-site paste path reifies the payload into ONE subtree and crashes the whole
	// Designer on more than one top-level node. Snippets with several top-level elements are
	// normal (`<style>` + markup, a list of sections), so give them a single Block parent.
	if (rootIds.length > 1) {
		nodes.unshift(createWrapperNode(newId(), rootIds));
	}

	return createPayload(nodes, styles.toArray());
};
