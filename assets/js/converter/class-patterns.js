/**
 * User-defined class-name patterns, for telling the converter what a project's naming
 * conventions MEAN.
 *
 * Without them the converter can only guess from the stylesheet: a second class becomes a combo
 * when a `.a.b` rule exists, and stays passthrough text otherwise. A framework like Lumos or
 * Client-First encodes the same information in the NAME - `is-active` is a combo, `u-mb-4` is a
 * utility - and these patterns let the author say so.
 *
 * Patterns are globs, one per line (commas also work), where `*` matches any run of characters:
 *
 *   cc-*        matches cc-variant-2
 *   is-*        matches is-active
 *   u-*         matches u-mb-4
 *   text-*      matches text-lg
 *   sm:*        matches sm:w-1/2
 *
 * Matched against the RAW class token, not the Webflow-normalized one, because that is what the
 * author actually wrote - `sm:*` would never match if it were normalized to `sm-w-1-2` first.
 * Matching is case-insensitive; Webflow lowercases class names anyway.
 */

const GLOB_SPECIALS = /[.+?^${}()|[\]\\]/g;

/**
 * @param {string} text  the textarea contents
 * @returns {RegExp[]} empty when nothing usable was written, which means "no opinion"
 */
export const compilePatterns = (text) => {
	if (typeof text !== "string") return [];

	return text
		.split(/[\n,]/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((glob) => new RegExp(`^${glob.replace(GLOB_SPECIALS, "\\$&").replace(/\*/g, ".*")}$`, "i"));
};

/** @returns {boolean} false for an empty pattern list, so an unconfigured box changes nothing */
export const matchesAny = (className, patterns) => patterns.some((p) => p.test(className));
