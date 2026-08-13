import { CSS_SHORTHANDS, EMBED_ONLY_PROPERTIES, NOISE_DEFAULTS, PANEL_STYLE_PROPERTIES, PREFERRED_SHORTHANDS, PROPERTY_ALIASES, UNREPRESENTABLE_VALUE } from "../config/constants.js";

/**
 * Inline `style="..."` and stylesheet rules -> the `styleLess` string Webflow stores on a style
 * block.
 *
 * NOTE: this leans on the browser's CSS parser (`el.style.cssText`) to expand shorthands, so it
 * needs a DOM. If the converter ever has to run outside a browser, this is the module to replace.
 */

const PANEL_PROPERTIES = new Set(PANEL_STYLE_PROPERTIES);
const EMBED_ONLY = new Set(EMBED_ONLY_PROPERTIES);

/**
 * Filler the browser invents when expanding a shorthand.
 *
 * A shorthand listing SEVERAL values (`transition: a .25s ease, b .25s ease`) expands to
 * comma-joined longhands, so the noise default arrives repeated - "normal, normal, normal"
 * rather than "normal". Every part has to be filler for the declaration to be dropped.
 */
const isExpansionNoise = (prop, value) => {
	if (value === "initial") return true;

	const filler = NOISE_DEFAULTS[prop];
	if (filler === undefined) return false;
	return value.split(",").every((part) => part.trim() === filler);
};

/**
 * The declarations of a `style="..."` string as the AUTHOR wrote them.
 *
 * Needed because the CSSOM cannot always be trusted to hand a declaration back - see the
 * pending-substitution case in expandDeclarations. Splitting is paren- and quote-aware: a `;`
 * inside `url(data:...;base64,...)` is part of the value, not a separator.
 */
const splitDeclarations = (cssText) => {
	const out = [];
	let depth = 0;
	let quote = "";
	let start = 0;

	const take = (end) => {
		const chunk = cssText.slice(start, end);
		const colon = chunk.indexOf(":");
		if (colon > 0) {
			const property = chunk.slice(0, colon).trim().toLowerCase();
			const value = chunk.slice(colon + 1).trim();
			if (property && value) out.push({ property, value });
		}
		start = end + 1;
	};

	for (let i = 0; i < cssText.length; i++) {
		const c = cssText[i];
		if (quote) {
			if (c === "\\") i += 1;
			else if (c === quote) quote = "";
		} else if (c === '"' || c === "'") quote = c;
		else if (c === "(") depth += 1;
		else if (c === ")") depth -= 1;
		else if (c === ";" && depth === 0) take(i);
	}
	take(cssText.length);

	return out;
};

/**
 * Serialize one declaration.
 *
 * `@raw<|...|>` is how Webflow routes a value into the Style panel's "Custom properties" section.
 * It is needed in TWO cases, both verified against the Designer:
 *
 *   1. the property has no panel control at all (`translate`, `padding-inline`)
 *   2. the property HAS one, but the value does not fit it (`padding-left: calc(2 * 1rem)`)
 *
 * Written plain in either case the CSS still renders, but the Designer shows nothing for it - the
 * value becomes invisible and uneditable, which is the whole point of this wrapper.
 *
 * CSS custom properties (`--brand: red`) are left alone: they are a separate Webflow concept and
 * the behaviour here is unverified, so this does not invent one.
 */
export const formatDeclaration = (prop, value) => {
	const fitsAControl = PANEL_PROPERTIES.has(prop) && !UNREPRESENTABLE_VALUE.test(value);
	if (fitsAControl || prop.startsWith("--")) return `${prop}: ${value}`;
	return `${prop}: @raw<|${value}|>`;
};

/** `["color: red", ...]` -> the `styleLess` string Webflow stores. "" for nothing. */
const serialize = (declarations) => (declarations.length > 0 ? declarations.join("; ") + ";" : "");

/**
 * Expand CSS shorthands (margin, padding, border, ...) into the longhands Webflow's Style panel
 * understands, dropping the filler the browser invents along the way.
 *
 * @returns {{kept: string[], deferred: string[]}} `kept` is everything the Style panel can show,
 *   serialized for `styleLess`. `deferred` holds the declarations it cannot show at all
 *   (EMBED_ONLY_PROPERTIES), written as plain CSS - the caller decides whether it has a Code Embed
 *   to leave them in, since only a STYLESHEET rule has a selector to write them back under.
 */
export const expandDeclarations = (cssText) => {
	if (!cssText) return { kept: [], deferred: [] };

	const el = document.createElement("div");
	el.style.cssText = cssText;

	const expanded = [];
	const deferred = [];

	const listed = new Set();
	for (let i = 0; i < el.style.length; i++) listed.add(el.style[i]);

	// A SHORTHAND whose value contains var() is "pending-substitution": the CSSOM lists all of
	// its longhands but serializes every one of them as "". Expanding it therefore DROPS the
	// declaration entirely - `background: linear-gradient(160deg, var(--x), #0d0d18)` vanishes,
	// and the element silently loses its background. So those are emitted exactly as authored.
	//
	// Only shorthands need this. A LONGHAND holding var() (`color: var(--text)`) survives the
	// round trip fine, and is recognisable because it appears in the listing above.
	//
	// This is also the ONLY way a bare shorthand reaches styleLess, which is why it is the only
	// place that has to check EMBED_ONLY: the CSSOM never lists a shorthand, so every other loop
	// below is emitting longhands.
	const handled = new Set();
	for (const { property, value } of splitDeclarations(cssText)) {
		if (!value.includes("var(") || listed.has(property)) continue;
		if (EMBED_ONLY.has(property)) deferred.push(`${property}: ${value}`);
		else expanded.push(formatDeclaration(property, value));
		handled.add(property);
	}

	// Emit the shorthands Webflow writes itself, and remember their longhands so the main loop
	// does not emit the same thing twice under names the panel does not recognise.
	for (const [shorthand, longhands] of Object.entries(PREFERRED_SHORTHANDS)) {
		if (handled.has(shorthand)) continue;
		const value = el.style.getPropertyValue(shorthand);
		// Empty means the longhands disagree and cannot collapse - let them through individually.
		if (!value) continue;
		expanded.push(formatDeclaration(shorthand, value));
		longhands.forEach((l) => handled.add(l));
	}

	for (let i = 0; i < el.style.length; i++) {
		const prop = el.style[i];
		// Let the browser expand shorthands into longhands, then drop the raw shorthand names.
		if (CSS_SHORTHANDS.includes(prop) || handled.has(prop) || prop in PREFERRED_SHORTHANDS) continue;
		const value = el.style.getPropertyValue(prop);
		// An empty value is not a style. It means the browser could not give this longhand back -
		// pending substitution above, or a shorthand whose parts disagree - and writing
		// `background-color: ;` into styleLess is a broken declaration, not a faithful one.
		if (!value || isExpansionNoise(prop, value)) continue;
		expanded.push(formatDeclaration(PROPERTY_ALIASES[prop] ?? prop, value));
	}

	return { kept: expanded, deferred };
};

/**
 * The `styleLess` for an inline `style="..."`.
 *
 * An inline style has no selector, so there is no rule the deferred declarations could be left in
 * - they are folded back in rather than dropped. They render and publish correctly; the cost is
 * that the Designer shows no row for them. A stylesheet rule does have a selector and takes the
 * better path - see collectStylesheets.
 */
export const expandInlineStyles = (cssText) => {
	const { kept, deferred } = expandDeclarations(cssText);
	return serialize([...kept, ...deferred]);
};

/** The `styleLess` for a stylesheet rule, leaving the panel-invisible declarations behind. */
export const expandRuleStyles = (cssText) => {
	const { kept, deferred } = expandDeclarations(cssText);
	return { styleLess: serialize(kept), deferred };
};
