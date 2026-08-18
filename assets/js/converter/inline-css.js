import { CSS_SHORTHANDS, EMBED_ONLY_PROPERTIES, GRID_TRACK_PROPERTIES, MAX_REPEAT_EXPANSION, NOISE_DEFAULTS, PANEL_STYLE_PROPERTIES, PREFERRED_SHORTHANDS, PROPERTY_ALIASES, UNREPRESENTABLE_VALUE } from "../config/constants.js";

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

/** Drop `/* ... *\/` spans, leaving anything that only LOOKS like one inside a string alone. */
const stripComments = (cssText) => {
	let out = "";
	let quote = "";

	for (let i = 0; i < cssText.length; i++) {
		const c = cssText[i];
		if (quote) {
			out += c;
			if (c === "\\") out += cssText[++i] ?? "";
			else if (c === quote) quote = "";
			continue;
		}
		if (c === '"' || c === "'") quote = c;
		else if (c === "/" && cssText[i + 1] === "*") {
			const close = cssText.indexOf("*/", i + 2);
			i = close === -1 ? cssText.length : close + 1;
			continue;
		}
		out += c;
	}

	return out;
};

/**
 * The declarations of a declaration block as the AUTHOR wrote them.
 *
 * Needed because the CSSOM cannot always be trusted to hand a declaration back - see the
 * pending-substitution case in expandDeclarations. Splitting is paren- and quote-aware: a `;`
 * inside `url(data:...;base64,...)` is part of the value, not a separator.
 */
const splitDeclarations = (source) => {
	const cssText = stripComments(source);
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

const GRID_TRACK_PROPS = new Set(GRID_TRACK_PROPERTIES);

/** Index of the ")" closing the "(" at `open`, or -1. Quote-aware. */
const closingParen = (text, open) => {
	let depth = 0;
	let quote = "";

	for (let i = open; i < text.length; i++) {
		const c = text[i];
		if (quote) {
			if (c === "\\") i += 1;
			else if (c === quote) quote = "";
		} else if (c === '"' || c === "'") quote = c;
		else if (c === "(") depth += 1;
		else if (c === ")" && --depth === 0) return i;
	}

	return -1;
};

/**
 * Rewrite `repeat(N, <tracks>)` as the track list it stands for.
 *
 * Webflow's Grid control cannot read repeat() - it reports "1 column" for
 * `repeat(3, 1fr)` while the canvas renders three, and touching the stepper then overwrites the
 * author's value with that wrong count. Webflow's own grids are always written as explicit
 * tracks (`1fr minmax(0px, 1fr)`), and `repeat(3, 1fr)` IS `1fr 1fr 1fr` - identical
 * cascade, identical rendering - so expanding it hands the panel something it understands
 * without changing the CSS's meaning.
 *
 * @returns {string|null} null when the value cannot be expanded, which is the `auto-fill` /
 *   `auto-fit` form: those resolve against the container's width at layout time and have no
 *   fixed track list. Those are routed to Custom properties instead (UNREPRESENTABLE_VALUE), so
 *   at least the Grid control does not claim a value it is misreading.
 */
const expandRepeat = (value) => {
	const lower = value.toLowerCase();
	let out = "";
	let i = 0;

	while (i < value.length) {
		const at = lower.indexOf("repeat(", i);
		if (at === -1) return out + value.slice(i);

		// "repeat(" has to be a function name of its own, not the tail of another identifier.
		if (at > 0 && /[\w-]/.test(value[at - 1])) {
			out += value.slice(i, at + 7);
			i = at + 7;
			continue;
		}

		const close = closingParen(value, at + 6);
		if (close === -1) return null; // unbalanced - do not try to rewrite it

		const args = value.slice(at + 7, close);
		const comma = args.indexOf(",");
		if (comma === -1) return null;

		// The count is <integer> | auto-fill | auto-fit, and never contains a comma or parens,
		// so the FIRST comma always separates it from the track list.
		const count = Number(args.slice(0, comma).trim());
		const tracks = args.slice(comma + 1).trim();
		if (!Number.isInteger(count) || count < 1 || count > MAX_REPEAT_EXPANSION || !tracks) return null;

		out += value.slice(i, at) + Array(count).fill(tracks).join(" ");
		i = close + 1;
	}

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
	// A grid track list is normalized first: an expandable repeat() becomes explicit tracks, which
	// the Grid control CAN read. One that cannot be expanded still contains "repeat(" and so fails
	// the test below, sending it to Custom properties rather than to a control that misreads it.
	const resolved = (GRID_TRACK_PROPS.has(prop) ? expandRepeat(value) : null) ?? value;

	const fitsAControl = PANEL_PROPERTIES.has(prop) && !UNREPRESENTABLE_VALUE.test(resolved);
	if (fitsAControl || prop.startsWith("--")) return `${prop}: ${resolved}`;
	return `${prop}: @raw<|${resolved}|>`;
};

/** `["color: red", ...]` -> the `styleLess` string Webflow stores. "" for nothing. */
const serialize = (declarations) => (declarations.length > 0 ? declarations.join("; ") + ";" : "");

/**
 * Whether a deferred shorthand shares its property family with anything else in the same rule,
 * which makes the rule unsafe to SPLIT even though the shorthand itself cannot be adopted.
 *
 * ```css
 * .gradient-text { background: linear-gradient(…, var(--v), …); background-clip: text; }
 * ```
 *
 * Moving only `background` into the Code Embed puts it AFTER the adopted `background-clip` in
 * the cascade - the embed's <style> sits in the body, Webflow's stylesheet in the head - where
 * the shorthand resets `background-clip` back to `border-box` and silently kills the effect.
 * A vendor-prefixed sibling counts too: the CSSOM folds `-webkit-background-clip` into the
 * unprefixed name, so splitting would drop the prefix as well.
 *
 * Such a rule is left whole in the embed instead. Its class still becomes a style block, just an
 * empty one - correct CSS beats a half-populated Style panel.
 */
const isEntangled = (shorthands, authored) =>
	shorthands.some((shorthand) => {
		const family = new RegExp(`^(?:-[a-z]+-)?${shorthand}(?:-|$)`, "i");
		return authored.some(({ property }) => property !== shorthand && family.test(property));
	});

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
	if (!cssText) return { kept: [], deferred: [], entangled: false };

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
	const authored = splitDeclarations(cssText);
	const handled = new Set();
	const deferredShorthands = [];

	for (const { property, value } of authored) {
		if (!value.includes("var(") || listed.has(property)) continue;
		if (EMBED_ONLY.has(property)) {
			deferred.push(`${property}: ${value}`);
			deferredShorthands.push(property);
		} else {
			expanded.push(formatDeclaration(property, value));
		}
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

	return { kept: expanded, deferred, entangled: isEntangled(deferredShorthands, authored) };
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
	const { kept, deferred, entangled } = expandDeclarations(cssText);
	return { styleLess: serialize(kept), deferred, entangled };
};
