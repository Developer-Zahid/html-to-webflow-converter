import { expandRuleStyles } from "./inline-css.js";

/**
 * Splits a <style> block into what Webflow's Style panel can hold natively and what has to stay
 * as raw CSS in a Code Embed.
 *
 * A rule is adopted only when it is a plain class selector, optionally with one of the pseudo
 * states the Style panel exposes, and that class is one the converter turns into a real Webflow
 * style block. A `@media` rule is adopted only when its condition is EXACTLY one of Webflow's
 * own breakpoint queries; its inner rules then go through the same per-rule test, targeting that
 * breakpoint's variant. Everything else - other media queries, keyframes, descendant/child
 * selectors, pseudo ELEMENTS, id and tag selectors - is left untouched so it keeps working from
 * the embed.
 *
 * Verified against a live Designer (reference payload of an element styled at every breakpoint):
 * the variant key is the bare breakpoint name for its base styles (`medium`, `xl`, ...) and
 * `<breakpoint>_<state>` for pseudo-states (`medium_hover`), with `main` as the base breakpoint
 * whose base styles live in `styleLess` itself. Values need NO `@raw<|...|>` wrapper, and
 * Webflow emits real CSS for each state (`.cls:hover`, `.cls:active`, ...).
 *
 * The CSSOM is used to CLASSIFY rules, never to re-emit them. `rule.cssText` is the browser's
 * normalization, and it rewrites declarations: `border-top: none` comes back as three longhands,
 * `transition: all .3s ease` as `transition: .3s`. Leftover CSS is code the user still has to
 * read and maintain in a Code Embed, so it is sliced out of the ORIGINAL source instead. The
 * split below therefore has to find rule boundaries itself.
 */

/** Pseudo-classes with a Style-panel equivalent, mapped to their variant-key suffix. */
const STATE_SUFFIX = {
	hover: "hover",
	active: "active",
	focus: "focus",
	"focus-visible": "focus-visible",
};

/** Webflow's base (desktop) breakpoint. Narrower breakpoints use their own prefixes. */
const BASE_BREAKPOINT = "main";

/**
 * Webflow's breakpoint media conditions, exactly as the CSSOM serializes them, mapped to the
 * variant-key prefix each one uses. The prefixes come from a reference payload copied out of a
 * live Designer (an element styled at every breakpoint); the widths are the ones Webflow's own
 * published CSS uses. max-width queries cascade DOWN from `main` and min-width queries cascade
 * UP, which is exactly how Webflow's variants inherit - so semantics survive the move.
 *
 * Only EXACT matches are adopted. Anything else - unusual widths, ranges, feature queries like
 * `(hover: hover)`, `print` - stays in the Code Embed so nothing is lost.
 */
const MEDIA_BREAKPOINTS = new Map([
	["(max-width: 991px)", "medium"],
	["(max-width: 767px)", "small"],
	["(max-width: 479px)", "tiny"],
	["(min-width: 1280px)", "large"],
	["(min-width: 1440px)", "xl"],
	["(min-width: 1920px)", "xxl"],
]);

/**
 * `.foo`, `.foo.bar`, and either with one pseudo-state - deliberately nothing more complex.
 *
 * The two-class form is how a Webflow COMBO is written, so `.card.featured` can be lifted into a
 * combo style block rather than left in the embed. A third class has no Webflow equivalent this
 * converter can build, so it does not match.
 */
const CLASS_CHAIN_SELECTOR = /^\.(-?[_a-zA-Z][\w-]*)(?:\.(-?[_a-zA-Z][\w-]*))?(?::([a-z-]+))?$/;

/**
 * @returns {string|null} the variant prefix for a media condition, or null when the query is not
 * one of Webflow's breakpoints. `screen and` / `only screen and` wrappers are tolerated because
 * Webflow's own published CSS writes `@media screen and (max-width: 991px)`.
 */
const breakpointForMedia = (conditionText) => {
	const condition = conditionText
		.trim()
		.replace(/^only\s+/, "")
		.replace(/^(?:screen|all)\s+and\s+/, "");
	return MEDIA_BREAKPOINTS.get(condition) ?? null;
};

/**
 * Parse the CSS without applying it to the page. A constructable stylesheet is used precisely
 * because it is inert - appending a real <style> would restyle the converter's own UI.
 * @returns {CSSRule[]|null} null when the CSS cannot be parsed at all
 */
const parseCss = (cssText) => {
	try {
		const sheet = new CSSStyleSheet();
		sheet.replaceSync(cssText);
		return Array.from(sheet.cssRules);
	} catch {
		return null;
	}
};

/**
 * Classify a single sliced segment.
 * @returns {CSSRule|null} null when the segment is not exactly one rule the CSSOM understands -
 *   invalid CSS, an at-rule it drops (`@import`), or several rules run together. Such a segment
 *   is never adopted, so it survives verbatim instead of being silently discarded.
 */
const parseOneRule = (cssText) => {
	const rules = parseCss(cssText);
	return rules?.length === 1 ? rules[0] : null;
};

/**
 * Split CSS source into top-level segments, each holding its ORIGINAL text.
 *
 * Brace counting is enough here, but only because comments and strings are skipped wholesale -
 * both can legally contain an unbalanced `{`, `}` or `;` (`content: "}"`), and miscounting would
 * corrupt every later slice.
 *
 * @returns {{text: string, isComment: boolean}[]} in source order; whitespace between segments
 *   is dropped, comments are kept as their own segments
 */
const splitTopLevelSegments = (cssText) => {
	const segments = [];
	let start = -1; // first non-whitespace char of the segment being scanned
	let depth = 0;
	let i = 0;

	const endSegment = (end, isComment = false) => {
		segments.push({ text: cssText.slice(start, end), isComment });
		start = -1;
	};

	while (i < cssText.length) {
		const char = cssText[i];

		if (char === "/" && cssText[i + 1] === "*") {
			const close = cssText.indexOf("*/", i + 2);
			const end = close === -1 ? cssText.length : close + 2;
			// Only a comment BETWEEN rules is a segment of its own; one inside a selector or a
			// declaration block is just part of that rule's text.
			if (depth === 0 && start === -1) {
				start = i;
				endSegment(end, true);
			}
			i = end;
			continue;
		}

		if (char === '"' || char === "'") {
			if (start === -1) start = i;
			i++;
			while (i < cssText.length && cssText[i] !== char) {
				if (cssText[i] === "\\") i++;
				i++;
			}
			i++;
			continue;
		}

		if (start === -1) {
			if (/\s/.test(char)) {
				i++;
				continue;
			}
			start = i;
		}

		if (char === "{") {
			depth++;
		} else if (char === "}") {
			depth--;
			if (depth <= 0) {
				endSegment(i + 1);
				depth = 0; // a stray `}` must not push the count negative
			}
		} else if (char === ";" && depth === 0) {
			endSegment(i + 1); // a block-less at-rule: @import, @charset
		}

		i++;
	}

	// Unterminated trailing text - malformed, but keeping it beats dropping it.
	if (start !== -1) endSegment(cssText.length);

	return segments;
};

/**
 * Split a block segment (`@media ... { ... }`) into its prelude and body, by source position.
 * @returns {{prelude: string, body: string}|null}
 */
const openBlock = (segmentText) => {
	const open = segmentText.indexOf("{");
	const close = segmentText.lastIndexOf("}");
	if (open === -1 || close < open) return null;
	return { prelude: segmentText.slice(0, open + 1), body: segmentText.slice(open + 1, close) };
};

/** @returns {{className: string, combo: string|null, state: string|null}|null} null if unadoptable */
const parseSelector = (selector) => {
	const match = CLASS_CHAIN_SELECTOR.exec(selector.trim());
	if (!match) return null;

	const [, className, combo, pseudo] = match;
	if (pseudo && !STATE_SUFFIX[pseudo]) return null;
	return { className, combo: combo ?? null, state: pseudo ? STATE_SUFFIX[pseudo] : null };
};

/**
 * @param {HTMLStyleElement[]} styleElements  every <style> in the parsed document
 * @param {Set<string>} adoptableClasses  normalized names that become Webflow style blocks
 * @param {Set<string>} [adoptableCombos]  `"<base> <combo>"` pairs that some element actually
 *   carries. A `.a.b` rule is only adopted when its pair is in here - otherwise the rule would
 *   be stripped from the embed and then never instantiated, losing it entirely.
 * @returns {{
 *   rulesByClass: Map<string, {
 *     base: string,
 *     variants: Record<string, {styleLess: string}>,
 *     combos: Map<string, {base: string, variants: Record<string, {styleLess: string}>}>
 *   }>,
 *   leftoverByElement: Map<HTMLStyleElement, string>
 * }}
 */
export const collectStylesheets = (styleElements, adoptableClasses, adoptableCombos = new Set()) => {
	const rulesByClass = new Map();
	const leftoverByElement = new Map();

	const entryFor = (className, comboName) => {
		if (!rulesByClass.has(className)) rulesByClass.set(className, { base: "", variants: {}, combos: new Map() });
		const entry = rulesByClass.get(className);
		if (!comboName) return entry;

		// A combo keeps its own base/variants; the shape is identical so the same variant keying
		// works for `.card.featured:hover` and `@media … { .card.featured { … } }`.
		if (!entry.combos.has(comboName)) entry.combos.set(comboName, { base: "", variants: {} });
		return entry.combos.get(comboName);
	};

	const addDeclarations = (className, comboName, breakpoint, state, declarations) => {
		const entry = entryFor(className, comboName);
		if (breakpoint === BASE_BREAKPOINT && !state) {
			entry.base = [entry.base, declarations].filter(Boolean).join(" ");
			return;
		}
		// Base breakpoint states are `main_hover`; another breakpoint's base styles are keyed by
		// the bare breakpoint name (`medium`), its states by `medium_hover`.
		const key = state ? `${breakpoint}_${state}` : breakpoint;
		const existing = entry.variants[key]?.styleLess;
		entry.variants[key] = { styleLess: [existing, declarations].filter(Boolean).join(" ") };
	};

	const NOT_ADOPTED = { adopted: false, leftover: null };

	/**
	 * Adopt one style rule into the given breakpoint's styles, or report that it cannot be.
	 *
	 * The SELECTOR is all-or-nothing: a grouped selector is only adopted when every branch of it
	 * maps, otherwise the rule stays whole in the embed and nothing is silently dropped. Its
	 * DECLARATIONS are not - a property the Style panel cannot show at all would be invisible in
	 * the Designer once lifted (see EMBED_ONLY_PROPERTIES), so those stay behind in a rule of their
	 * own while the rest of the block still goes native.
	 *
	 * @param {string} sourceText  the rule's ORIGINAL text. `rule.style.cssText` is not a reliable
	 *   record of what the author wrote: a shorthand whose longhands are later overridden cannot be
	 *   reconstructed, so the CSSOM drops it from the serialization entirely. Combined with pending
	 *   substitution that silently DELETES the declaration -
	 *   `background: linear-gradient(…var(--v)…); background-clip: text` comes back as eight empty
	 *   longhands and no `background` at all. The authored block is the only faithful source.
	 * @returns {{adopted: boolean, leftover: string|null}} `leftover` is CSS the caller must keep
	 *   in the embed. Unlike every other leftover this one is PRINTED rather than sliced from the
	 *   source - the rule is being split, so there is no original text for half of it. Only the
	 *   declarations are reprinted though, and they are reprinted as the author wrote them.
	 */
	const tryAdoptStyleRule = (rule, breakpoint, sourceText) => {
		if (rule.type !== CSSRule.STYLE_RULE) return NOT_ADOPTED;

		const parsed = rule.selectorText.split(",").map(parseSelector);
		const usable = (p) =>
			p && adoptableClasses.has(p.className) && (!p.combo || adoptableCombos.has(`${p.className} ${p.combo}`));
		if (!parsed.every(usable)) return NOT_ADOPTED;

		const authored = openBlock(sourceText)?.body ?? rule.style.cssText;
		const { styleLess, deferred, entangled } = expandRuleStyles(authored);

		// Everything the panel can hold was deferred, so there is nothing to lift - leave the rule
		// exactly where it is instead of splitting it into an identical copy of itself.
		if (!styleLess) return NOT_ADOPTED;
		// Splitting this one would change what it MEANS - see isEntangled.
		if (entangled) return NOT_ADOPTED;

		parsed.forEach((p) => addDeclarations(p.className, p.combo, breakpoint, p.state, styleLess));
		return {
			adopted: true,
			leftover: deferred.length > 0 ? `${rule.selectorText} {\n  ${deferred.join(";\n  ")};\n}` : null,
		};
	};

	/**
	 * Adopt what it can out of a breakpoint-matching @media block.
	 * @returns {{adopted: boolean, leftover: string|null}} `leftover` is the segment's original
	 *   text when nothing was adopted, a rebuild carrying only the unadopted rules when some was,
	 *   and null when the whole block went native.
	 */
	const adoptMediaBlock = (segmentText, breakpoint) => {
		const block = openBlock(segmentText);
		if (!block) return { adopted: false, leftover: segmentText };

		const keep = [];
		let adopted = false;

		for (const inner of splitTopLevelSegments(block.body)) {
			if (inner.isComment) continue;
			const rule = parseOneRule(inner.text);
			const result = rule ? tryAdoptStyleRule(rule, breakpoint, inner.text) : NOT_ADOPTED;
			if (!result.adopted) {
				keep.push(inner.text);
				continue;
			}
			adopted = true;
			// Re-wrapped in this block's own @media below, so it keeps applying at this breakpoint
			// only - exactly where the adopted half of the rule went.
			if (result.leftover) keep.push(result.leftover);
		}

		if (!adopted) return { adopted: false, leftover: segmentText };
		if (keep.length === 0) return { adopted: true, leftover: null };
		// Partially adopted, so the block has to be rebuilt - but out of the ORIGINAL prelude and
		// the ORIGINAL text of each rule that stayed behind.
		return { adopted: true, leftover: `${block.prelude}\n${keep.map((text) => `  ${text}`).join("\n")}\n}` };
	};

	for (const styleEl of styleElements) {
		const source = styleEl.textContent ?? "";
		const leftover = [];
		let adoptedAnything = false;

		for (const segment of splitTopLevelSegments(source)) {
			// A comment sits between rules, so there is no telling whether it describes one that
			// was adopted. Dropping it beats stranding "/* medium breakpoint */" in the embed above
			// a rule that is no longer there.
			if (segment.isComment) continue;

			const rule = parseOneRule(segment.text);

			// A @media rule matching one of Webflow's breakpoints is opened up and its inner rules
			// adopted individually into that breakpoint's variants; whatever does not map is
			// re-wrapped in the same @media so the embed keeps its original meaning.
			if (rule?.type === CSSRule.MEDIA_RULE) {
				const breakpoint = breakpointForMedia(rule.conditionText ?? rule.media.mediaText);
				if (breakpoint) {
					const result = adoptMediaBlock(segment.text, breakpoint);
					if (result.adopted) adoptedAnything = true;
					if (result.leftover !== null) leftover.push(result.leftover);
					continue;
				}
			}

			const result = rule ? tryAdoptStyleRule(rule, BASE_BREAKPOINT, segment.text) : NOT_ADOPTED;
			if (result.adopted) {
				adoptedAnything = true;
				if (result.leftover) leftover.push(result.leftover);
				continue;
			}
			leftover.push(segment.text);
		}

		// Nothing was adopted - hand back the whole original block, so the comments and blank lines
		// the segment walk drops survive too.
		leftoverByElement.set(styleEl, adoptedAnything ? leftover.join("\n") : source);
	}

	return { rulesByClass, leftoverByElement };
};
