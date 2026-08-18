import { normalizeClassName, splitClasses } from "./class-names.js";
import { expandInlineStyles } from "./inline-css.js";

/**
 * Resolve one element's Webflow style ids and its passthrough `class` string.
 *
 * Shared by the generic element path and the native-form builder so form fields get the same
 * class and inline-style treatment as everything else.
 */
export const resolveElementStyling = (element, styles) => {
	const { mainClass, otherClasses } = splitClasses(element, styles.isUtilityClass);
	const inlineStyle = expandInlineStyles(element.getAttribute("style"));

	// Both forms travel together: patterns are tested against the RAW token the author wrote,
	// stylesheet combos are keyed by the NORMALIZED name, and the raw token is what goes back
	// into the passthrough attribute.
	const others = otherClasses.map((raw) => ({ raw, name: normalizeClassName(raw) }));
	const { ids, consumed } = styles.resolveClassIds(mainClass, inlineStyle, others, element.tagName);

	return {
		classIds: ids,
		otherClasses: others.filter((o) => !consumed.has(o.name)).map((o) => o.raw).join(" ") || null,
	};
};
