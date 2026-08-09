import { expandInlineStyles } from "./inline-css.js";

/**
 * Splits a <style> block into what Webflow's Style panel can hold natively and what has to stay
 * as raw CSS in a Code Embed.
 *
 * A rule is adopted only when it is a plain class selector, optionally with one of the pseudo
 * states the Style panel exposes, and that class is one the converter turns into a real Webflow
 * style block. Everything else - media queries, keyframes, descendant/child selectors, pseudo
 * ELEMENTS, id and tag selectors - is left untouched so it keeps working from the embed.
 *
 * Verified against a live Designer: the variant key is `<breakpoint>_<state>` with `main` as the
 * base breakpoint, values need NO `@raw<|...|>` wrapper, and Webflow emits real CSS for each of
 * these states (`.cls:hover`, `.cls:active`, ...).
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

/** `.foo` or `.foo:hover` - deliberately nothing more complex. */
const SIMPLE_CLASS_SELECTOR = /^\.(-?[_a-zA-Z][\w-]*)(?::([a-z-]+))?$/;

const variantKey = (state) => `${BASE_BREAKPOINT}_${state}`;

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

/** @returns {{className: string, state: string|null}|null} null when not adoptable */
const parseSelector = (selector) => {
	const match = SIMPLE_CLASS_SELECTOR.exec(selector.trim());
	if (!match) return null;

	const [, className, pseudo] = match;
	if (pseudo && !STATE_SUFFIX[pseudo]) return null;
	return { className, state: pseudo ? STATE_SUFFIX[pseudo] : null };
};

/**
 * @param {HTMLStyleElement[]} styleElements  every <style> in the parsed document
 * @param {Set<string>} adoptableClasses  normalized names that become Webflow style blocks
 * @returns {{
 *   rulesByClass: Map<string, {base: string, variants: Record<string, {styleLess: string}>}>,
 *   leftoverByElement: Map<HTMLStyleElement, string>
 * }}
 */
export const collectStylesheets = (styleElements, adoptableClasses) => {
	const rulesByClass = new Map();
	const leftoverByElement = new Map();

	const entryFor = (className) => {
		if (!rulesByClass.has(className)) rulesByClass.set(className, { base: "", variants: {} });
		return rulesByClass.get(className);
	};

	const addDeclarations = (className, state, declarations) => {
		const entry = entryFor(className);
		if (state) {
			const key = variantKey(state);
			const existing = entry.variants[key]?.styleLess;
			entry.variants[key] = { styleLess: [existing, declarations].filter(Boolean).join(" ") };
		} else {
			entry.base = [entry.base, declarations].filter(Boolean).join(" ");
		}
	};

	for (const styleEl of styleElements) {
		const source = styleEl.textContent ?? "";
		const rules = parseCss(source);

		// Unparseable CSS is left exactly as the author wrote it.
		if (!rules) {
			leftoverByElement.set(styleEl, source);
			continue;
		}

		const leftover = [];
		let adoptedAnything = false;

		for (const rule of rules) {
			const selectors = rule.type === CSSRule.STYLE_RULE ? rule.selectorText.split(",") : null;
			const parsed = selectors?.map(parseSelector);
			// All-or-nothing per rule: a grouped selector is only adopted when every branch of it
			// maps, otherwise the rule stays whole in the embed and nothing is silently dropped.
			const adoptable = parsed?.every((p) => p && adoptableClasses.has(p.className));

			const declarations = adoptable ? expandInlineStyles(rule.style.cssText) : "";
			if (!adoptable || !declarations) {
				leftover.push(rule.cssText);
				continue;
			}

			parsed.forEach((p) => addDeclarations(p.className, p.state, declarations));
			adoptedAnything = true;
		}

		// Nothing was adopted - keep the author's original text rather than the CSSOM's
		// re-serialization, so comments and formatting survive.
		leftoverByElement.set(styleEl, adoptedAnything ? leftover.join("\n") : source);
	}

	return { rulesByClass, leftoverByElement };
};
