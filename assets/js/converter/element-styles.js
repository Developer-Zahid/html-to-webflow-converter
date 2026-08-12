import { normalizeClassName, splitClasses } from "./class-names.js";
import { expandInlineStyles } from "./inline-css.js";

/**
 * Resolve one element's Webflow style ids and its passthrough `class` string.
 *
 * Shared by the generic element path and the native-form builder so form fields get the same
 * class and inline-style treatment as everything else.
 */
export const resolveElementStyling = (element, styles) => {
	const { mainClass, otherClasses } = splitClasses(element);
	const inlineStyle = expandInlineStyles(element.getAttribute("style"));

	// Matched against the stylesheet's `.main.other` rules by their NORMALIZED names, the same
	// form a Webflow class would take - but the raw token is what stays in the passthrough, so
	// keep the two lists index-aligned.
	const normalized = otherClasses.map(normalizeClassName);
	const { ids, consumed } = styles.resolveClassIds(mainClass, inlineStyle, normalized);
	const passthrough = otherClasses.filter((_, i) => !consumed.has(normalized[i]));

	return {
		classIds: ids,
		otherClasses: passthrough.join(" ") || null,
	};
};
