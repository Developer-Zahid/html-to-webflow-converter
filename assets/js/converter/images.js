import { WEBFLOW_ASSET_ID_IN_URL, WEBFLOW_ASSET_URL_PREFIX, WEBFLOW_PLACEHOLDER_ASSET_ID, WEBFLOW_PLACEHOLDER_IMAGE } from "../config/constants.js";

/**
 * Decides whether an `<img>` becomes a native Webflow Image or a Custom Element.
 *
 * The deciding factor is NOT how it looks on the Designer canvas. A native Image renders any
 * external URL there quite happily - it is PUBLISH that breaks it, because Webflow rewrites a
 * published Image's src onto its own CDN and keeps only the path. So the canvas shows a working
 * photo while the live site serves a 404, and nothing in the Designer warns you.
 *
 * Hence the rule: a native Image only for a src that is ALREADY on Webflow's CDN, where that
 * rewrite is a no-op. Anything else stays a Custom Element, whose src publishes verbatim -
 * the rewrite is a property of the Image ELEMENT TYPE, not of image URLs in general.
 *
 * Both halves confirmed on a published page: of nine images, exactly two loaded - a Webflow-CDN
 * src in a native Image, and an external src in a Custom Element. Those are precisely the two
 * things this function emits. Every native Image holding a non-Webflow URL was broken.
 */

/**
 * @param {Element} element  the <img>
 * @param {{ nativeImages?: boolean }} [options]
 * @returns {{native: boolean, src: string}} `src` is what the node should carry, which is not
 *   always the author's - see the placeholder swap below
 */
export const resolveImage = (element, { nativeImages = false } = {}) => {
	const src = element.getAttribute("src")?.trim() ?? "";

	// Already a Webflow-hosted asset, so the publish rewrite cannot change it.
	if (src.startsWith(WEBFLOW_ASSET_URL_PREFIX)) return { native: true, src };

	// "Native Images" is on and this URL cannot survive publish. Swap in Webflow's placeholder:
	// an obvious "pick an image" marker in the Designer beats one that looks right there and
	// 404s once the site is live. The author replaces it with a real asset via Choose Image.
	if (nativeImages) return { native: true, src: WEBFLOW_PLACEHOLDER_IMAGE };

	return { native: false, src };
};

/**
 * The asset id an Image should claim for a given src, for `data.img.id`.
 *
 * Binding to a real asset is what makes Webflow generate a responsive `srcset` - verified, a
 * derived id produced seven variants with no `assets[]` entry in the payload. The full asset
 * DESCRIPTOR that Webflow ships (fileHash, dimensions, every variant) cannot be synthesized from
 * an HTML string, but it turns out not to be needed: the id alone is enough when the asset lives
 * on the target site.
 *
 * Safe when it does not. An id that resolves to nothing falls back to `data.attr.src`, so the
 * worst case is exactly the unbound behaviour we had before - no srcset, image still renders.
 * And a derived id can never point at the WRONG file, because it came out of that file's own URL.
 *
 * @returns {string} "" when the src has no id to recover, which is a valid value
 */
export const assetIdForSrc = (src) => {
	if (src === WEBFLOW_PLACEHOLDER_IMAGE) return WEBFLOW_PLACEHOLDER_ASSET_ID;
	return WEBFLOW_ASSET_ID_IN_URL.exec(src)?.[1] ?? "";
};
