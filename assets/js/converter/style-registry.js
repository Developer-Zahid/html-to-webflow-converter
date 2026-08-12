import { CREATED_BY } from "../config/constants.js";
import { idFromSeed } from "./ids.js";

/**
 * Collects the `styles` array of the clipboard payload and decides which style ids each element
 * gets. One registry per conversion.
 */

const makeStyle = (name, styleLess, variants = {}, comb = "") => ({
	_id: idFromSeed("class:" + name),
	fake: false,
	type: "class",
	name: name,
	namespace: "",
	// "" is a standalone class; "&" makes this a COMBO - it only applies chained onto its parent,
	// as `.base.combo`. The parent lists the combo's id in its own `children`.
	comb: comb,
	styleLess: styleLess, // Webflow expects raw CSS properties here
	variants: variants, // pseudo-state overrides, keyed `<breakpoint>_<state>`
	children: [],
	createdBy: CREATED_BY,
	origin: null,
	selector: null,
});

/**
 * Split a styleLess string into individual declarations.
 *
 * Not a plain `split(";")`: a value can legally contain one, inside `url(data:…;base64,…)` or
 * inside the `@raw<|…|>` wrapper, and cutting there would corrupt both declarations.
 */
const splitDeclarations = (styleLess) => {
	const declarations = [];
	let depth = 0;
	let inRaw = false;
	let start = 0;

	for (let i = 0; i < styleLess.length; i++) {
		if (!inRaw && styleLess.startsWith("<|", i)) {
			inRaw = true;
			i += 1;
		} else if (inRaw && styleLess.startsWith("|>", i)) {
			inRaw = false;
			i += 1;
		} else if (inRaw) {
			continue;
		} else if (styleLess[i] === "(") {
			depth += 1;
		} else if (styleLess[i] === ")") {
			depth -= 1;
		} else if (styleLess[i] === ";" && depth === 0) {
			declarations.push(styleLess.slice(start, i));
			start = i + 1;
		}
	}
	declarations.push(styleLess.slice(start));

	return declarations.map((d) => d.trim()).filter(Boolean);
};

/**
 * The declarations of `variant` that the base does not already say, verbatim.
 *
 * Whole declarations are compared rather than property names, which gets both cases right at
 * once: same property with the same value is already covered by the base and drops out, same
 * property with a DIFFERENT value survives and overrides.
 *
 * NOTE what this cannot express: a property the base sets and the variant does not. A combo can
 * only add to its parent, never unset, so that declaration keeps applying.
 */
const declarationsNotIn = (baseStyleLess, variantStyleLess) => {
	const base = new Set(splitDeclarations(baseStyleLess));
	const extra = splitDeclarations(variantStyleLess).filter((d) => !base.has(d));
	return extra.length > 0 ? extra.join("; ") + ";" : "";
};

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
	/** Combo style blocks, in creation order. Kept out of `byName` - they are not addressable by
	 * name alone, since the same combo name under two base classes is two different blocks. */
	const comboStyles = [];
	/** @type {Map<string, Map<string, object>>} base class name -> (combo name -> style block) */
	const combosByBase = new Map();
	/** @type {Map<string, Map<string, string>>} base -> (diff styleLess -> generated combo name),
	 * so two elements differing in exactly the same way share one `cc-variant-N`. */
	const variantNamesByBase = new Map();

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
	 * The combo style block for `.base.comboName`, created on first use.
	 *
	 * Seeded from the BASE as well as the name: `.card.featured` and `.button.featured` are
	 * different combinations and must be different style blocks, even though they share a class
	 * name. Verified against a live Designer - two same-named combos under different bases apply
	 * only to their own base, with no bleed.
	 */
	const ensureComboClass = (baseName, comboName, styleLess, variants = {}) => {
		if (!combosByBase.has(baseName)) combosByBase.set(baseName, new Map());
		const combos = combosByBase.get(baseName);
		if (combos.has(comboName)) return combos.get(comboName)._id;

		const style = makeStyle(comboName, styleLess, variants, "&");
		style._id = idFromSeed(`combo:${baseName}:${comboName}`);

		combos.set(comboName, style);
		comboStyles.push(style);
		byName.get(baseName).children.push(style._id);
		return style._id;
	};

	/**
	 * A generated combo for an element whose inline styles differ from the base's.
	 *
	 * Numbering starts at 2 because the base element is variant 1 - it needs no combo at all.
	 * Keyed by the diff so three elements differing in the same way share one `cc-variant-2`.
	 */
	const ensureInlineVariant = (baseName, diffStyleLess) => {
		if (!variantNamesByBase.has(baseName)) variantNamesByBase.set(baseName, new Map());
		const named = variantNamesByBase.get(baseName);
		if (!named.has(diffStyleLess)) named.set(diffStyleLess, `cc-variant-${named.size + 2}`);
		return ensureComboClass(baseName, named.get(diffStyleLess), diffStyleLess);
	};

	/**
	 * Resolve the ordered `classes` array for one element.
	 *
	 * The named class absorbs the element's inline styles the first time it is seen. A LATER
	 * element sharing the name but carrying different inline styles cannot append to that shared
	 * block - it would restyle every other element using the class - so it gets a COMBO class
	 * holding only what actually differs, exactly as chaining `.base.cc-variant-2` would.
	 *
	 * @param {string} mainClass  normalized style-block name, or "" for none
	 * @param {string} inlineStyle  expanded styleLess, or "" for none
	 * @param {string[]} [otherClasses]  the element's remaining classes, normalized
	 * @returns {{ids: string[], consumed: Set<string>}} `ids` is base class first; `consumed`
	 *   names the other classes that became combo style blocks and so must NOT also be written
	 *   out as a passthrough `class` attribute
	 */
	const resolveClassIds = (mainClass, inlineStyle, otherClasses = []) => {
		const ids = [];
		const consumed = new Set();

		if (!mainClass) {
			if (inlineStyle) ids.push(ensureInlineClass(inlineStyle));
			return { ids, consumed };
		}

		if (!byName.has(mainClass)) {
			// Stylesheet rules come first so the element's own inline styles win, the same way
			// they would in the browser.
			const sheet = sheetRules.get(mainClass);
			const base = [sheet?.base, inlineStyle].filter(Boolean).join(" ");
			byName.set(mainClass, makeStyle(mainClass, base, sheet?.variants ?? {}));
			inlineByName.set(mainClass, inlineStyle);
		}
		ids.push(byName.get(mainClass)._id);

		// Combos the stylesheet declared as `.main.other`, in the order the element lists them.
		const sheetCombos = sheetRules.get(mainClass)?.combos;
		otherClasses.forEach((name) => {
			const rule = sheetCombos?.get(name);
			if (!rule) return;
			ids.push(ensureComboClass(mainClass, name, rule.base, rule.variants));
			consumed.add(name);
		});

		// The element's OWN inline difference goes last so it wins over the stylesheet, matching
		// the order the browser would apply them in.
		if (inlineStyle && inlineStyle !== inlineByName.get(mainClass)) {
			const diff = declarationsNotIn(byName.get(mainClass).styleLess, inlineStyle);
			if (diff) ids.push(ensureInlineVariant(mainClass, diff));
		}

		return { ids, consumed };
	};

	return {
		resolveClassIds,
		ensureInlineClass,
		/** The payload's `styles` array. */
		toArray: () => [...byName.values(), ...comboStyles],
	};
};
