/**
 * Class-name handling.
 *
 * An element's class list is split in two: the FIRST token becomes a real Webflow style block,
 * every remaining token is passed through verbatim as a custom `class` attribute.
 */

/**
 * Reproduces how Webflow normalizes a style-block name when it emits CSS: lowercase, runs of
 * invalid chars collapse to ONE hyphen, surrounding -/_ trimmed, leading digit gets an "_"
 * prefix. Non-ASCII is DROPPED, not transliterated ("café" -> "caf", NOT "cafe").
 *
 * A name that normalizes to "" cannot exist as a Webflow class, so callers must treat "" as
 * "not a class".
 *
 * Verified against a live Designer: 64 of 64 existing classes matched. The counter-intuitive
 * rows (non-ASCII dropping, leading-digit prefix) are exactly what a well-meaning refactor
 * "fixes" into a transliterating slugifier - don't.
 */
export const normalizeClassName = (raw) => {
	if (typeof raw !== "string") return "";
	let out = raw
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/^[-_]+|[-_]+$/g, "");
	if (!out) return "";
	if (/^[0-9]/.test(out)) out = "_" + out;
	return out;
};

/**
 * Split an element's classes into the one that becomes a Webflow style block and the rest.
 *
 * Utility classes (Tailwind's `sm:w-1/2`, `text-[14px]`) are passed straight through so the
 * external stylesheet still matches them - rewriting them to `sm-w-1-2` silently breaks the
 * framework that was supposed to style the element.
 *
 * The rest are returned as RAW tokens rather than a joined string: a caller has to be able to
 * pull individual ones out, because a class the stylesheet described as `.main.other` becomes a
 * real combo style block instead of passthrough text.
 *
 * @returns {{ mainClass: string, otherClasses: string[] }} mainClass is "" when the first token
 *   cannot be a Webflow class (e.g. "!!!"), in which case it stays in the passthrough.
 */
export const splitClasses = (element) => {
	const rawClassList = element.classList ? Array.from(element.classList) : [];
	const mainClass = rawClassList.length > 0 ? normalizeClassName(rawClassList[0]) : "";
	return { mainClass, otherClasses: mainClass ? rawClassList.slice(1) : rawClassList };
};
