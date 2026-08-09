import { CSS_SHORTHANDS, NOISE_DEFAULTS, PANEL_STYLE_PROPERTIES, PREFERRED_SHORTHANDS, PROPERTY_ALIASES, UNREPRESENTABLE_VALUE } from "../config/constants.js";

/**
 * Inline `style="..."` and stylesheet rules -> the `styleLess` string Webflow stores on a style
 * block.
 *
 * NOTE: this leans on the browser's CSS parser (`el.style.cssText`) to expand shorthands, so it
 * needs a DOM. If the converter ever has to run outside a browser, this is the module to replace.
 */

const PANEL_PROPERTIES = new Set(PANEL_STYLE_PROPERTIES);

const isExpansionNoise = (prop, value) => {
	if (value === "initial") return true;
	return NOISE_DEFAULTS[prop] === value;
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

/**
 * Expand CSS shorthands (margin, padding, border, ...) into the longhands Webflow's Style panel
 * understands, dropping the filler the browser invents along the way.
 */
export const expandInlineStyles = (cssText) => {
	if (!cssText) return "";

	const el = document.createElement("div");
	el.style.cssText = cssText;

	const expanded = [];

	// Emit the shorthands Webflow writes itself, and remember their longhands so the main loop
	// does not emit the same thing twice under names the panel does not recognise.
	const handled = new Set();
	for (const [shorthand, longhands] of Object.entries(PREFERRED_SHORTHANDS)) {
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
		if (isExpansionNoise(prop, value)) continue;
		expanded.push(formatDeclaration(PROPERTY_ALIASES[prop] ?? prop, value));
	}

	return expanded.length > 0 ? expanded.join("; ") + ";" : "";
};
