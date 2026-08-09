import { CREATED_BY } from "../config/constants.js";
import { idFromSeed } from "./ids.js";

/**
 * Collects the `styles` array of the clipboard payload and decides which style ids each element
 * gets. One registry per conversion.
 */

const makeStyle = (name, styleLess, variants = {}) => ({
	_id: idFromSeed("class:" + name),
	fake: false,
	type: "class",
	name: name,
	namespace: "",
	comb: "",
	styleLess: styleLess, // Webflow expects raw CSS properties here
	variants: variants, // pseudo-state overrides, keyed `<breakpoint>_<state>`
	children: [],
	createdBy: CREATED_BY,
	origin: null,
	selector: null,
});

/**
 * @param {object} [deps]
 * @param {Map<string, {base: string, variants: object}>} [deps.sheetRules]  declarations lifted
 *   out of <style> blocks, keyed by style-block name (see stylesheet.js)
 */
export const createStyleRegistry = ({ sheetRules = new Map() } = {}) => {
	/** @type {Map<string, object>} keyed by style-block name */
	const byName = new Map();
	/** Inline-style string each named class absorbed, kept separate from the sheet's own rules. */
	const inlineByName = new Map();

	/**
	 * Auto-generated class for a block of inline CSS. Keyed by the CSS itself, so elements with
	 * identical inline styles share one class instead of getting one each.
	 */
	const ensureInlineClass = (inlineStyle) => {
		const name = "css-" + idFromSeed("inline:" + inlineStyle).slice(0, 8);
		if (!byName.has(name)) byName.set(name, makeStyle(name, inlineStyle));
		return byName.get(name)._id;
	};

	/**
	 * Resolve the ordered `classes` array for one element.
	 *
	 * The named class absorbs the element's inline styles the first time it is seen. If a LATER
	 * element shares the name but carries different inline styles, appending to the shared block
	 * would push this element's styles onto every other element using the class - so that element
	 * gets its own extra `css-*` class instead.
	 *
	 * @param {string} mainClass  normalized style-block name, or "" for none
	 * @param {string} inlineStyle  expanded styleLess, or "" for none
	 * @returns {string[]} style ids, base class first
	 */
	const resolveClassIds = (mainClass, inlineStyle) => {
		const ids = [];

		if (mainClass) {
			if (!byName.has(mainClass)) {
				// Stylesheet rules come first so the element's own inline styles win, the same way
				// they would in the browser.
				const sheet = sheetRules.get(mainClass);
				const base = [sheet?.base, inlineStyle].filter(Boolean).join(" ");
				byName.set(mainClass, makeStyle(mainClass, base, sheet?.variants ?? {}));
				inlineByName.set(mainClass, inlineStyle);
			} else if (inlineStyle && inlineStyle !== inlineByName.get(mainClass)) {
				ids.push(ensureInlineClass(inlineStyle));
			}
			// Base class first, extra class after.
			ids.unshift(byName.get(mainClass)._id);
		} else if (inlineStyle) {
			ids.push(ensureInlineClass(inlineStyle));
		}

		return ids;
	};

	return {
		resolveClassIds,
		ensureInlineClass,
		/** The payload's `styles` array. */
		toArray: () => Array.from(byName.values()),
	};
};
