import { splitClasses } from "./class-names.js";
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
	return {
		classIds: styles.resolveClassIds(mainClass, inlineStyle),
		otherClasses,
	};
};
