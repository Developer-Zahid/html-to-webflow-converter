import { CSS_EMBED_TAGS, DISPLAY_NAME_ATTRIBUTE, JS_EMBED_TAGS, MERGED_EMBED_NAMES } from "../config/constants.js";
import { newId } from "./ids.js";
import { createMergedEmbedNode } from "./nodes.js";

/**
 * Folds every code tag on the page into at most TWO Code Embeds - one for CSS, one for JS.
 *
 * Without this, a page with four <style>/<script> tags pastes as four separate Code Embeds
 * scattered through the Navigator. Behind the `mergeEmbeds` option because the default (an embed
 * where the tag actually was) keeps document order exactly, which is the safer thing to do
 * unasked.
 */

/** `v` has to be a tag skeleton; a merged embed has no source element to clone one from. */
const CSS_SKELETON = "<style></style>";
const JS_SKELETON = "<script></script>";

/**
 * Serialize a tag for the merged embed WITHOUT the display-name hook, which is an instruction to
 * this converter rather than markup. The merged embeds carry their own fixed Navigator names, so
 * a per-tag one has nowhere to go and must not be published either.
 */
const publishableHtml = (element) => {
	const clone = element.cloneNode(true);
	clone.removeAttribute(DISPLAY_NAME_ATTRIBUTE);
	return clone.outerHTML;
};

/** Attributes that make a tag worth keeping whole, ignoring the converter's own hook. */
const publishableAttributeCount = (element) =>
	Array.from(element.attributes).filter((a) => a.name !== DISPLAY_NAME_ATTRIBUTE).length;

/**
 * A plain <style> hands over its CSS text, so several of them collapse into one <style> tag.
 * Anything else - a <style media="print">, a <link> - keeps its own tag, because its attributes
 * carry meaning that a merge would silently drop.
 */
const asCssPart = (element) => {
	if (element.tagName === "STYLE" && publishableAttributeCount(element) === 0) {
		return { text: (element.textContent ?? "").trim(), mergeable: true };
	}
	return { text: publishableHtml(element), mergeable: false };
};

/**
 * Merge only ADJACENT mergeable chunks. Interleaving a <link> between two <style> blocks makes
 * the order load-bearing - CSS later in the document wins - so runs are flushed around anything
 * that keeps its own tag rather than hoisted past it.
 */
const buildCssContent = (elements) => {
	const out = [];
	let run = [];

	const flushRun = () => {
		if (run.length > 0) out.push(`<style>\n${run.join("\n\n")}\n</style>`);
		run = [];
	};

	for (const element of elements) {
		const part = asCssPart(element);
		if (!part.text) continue;
		if (part.mergeable) {
			run.push(part.text);
			continue;
		}
		flushRun();
		out.push(part.text);
	}
	flushRun();

	return out.join("\n");
};

/**
 * Scripts keep one tag each, unlike CSS. Concatenating two inline scripts into a single <script>
 * would change how they run: a `let` declared in both stops being two scopes and starts being a
 * redeclaration error, and a syntax error in the first would take the second down with it. One
 * embed holding several <script> tags is still one node in the Navigator, which is the point.
 */
const buildJsContent = (elements) => elements.map(publishableHtml).join("\n");

export const createEmbedCollector = () => {
	const buckets = { css: [], js: [] };

	const bucketFor = (tagName) => {
		if (CSS_EMBED_TAGS.includes(tagName)) return "css";
		if (JS_EMBED_TAGS.includes(tagName)) return "js";
		return null; // <noscript> belongs to neither and keeps its own embed
	};

	return {
		/** @returns {boolean} whether this tag is merged rather than embedded where it sits */
		accepts: (tagName) => bucketFor(tagName) !== null,

		/**
		 * @param {string} tagName
		 * @param {Element} element  the element to serialize - for a <style> this is the rebuilt
		 *   clone holding only the CSS that could not become native Webflow styles
		 */
		add: (tagName, element) => buckets[bucketFor(tagName)].push(element),

		/**
		 * @returns {{cssNode: object|null, jsNode: object|null}} null where a bucket produced no
		 *   code at all - e.g. every <style> rule was adopted into the Style panel
		 */
		toNodes: () => {
			const css = buildCssContent(buckets.css);
			const js = buildJsContent(buckets.js);
			return {
				cssNode: css ? createMergedEmbedNode(newId(), CSS_SKELETON, css, MERGED_EMBED_NAMES.css) : null,
				jsNode: js ? createMergedEmbedNode(newId(), JS_SKELETON, js, MERGED_EMBED_NAMES.js) : null,
			};
		},
	};
};
