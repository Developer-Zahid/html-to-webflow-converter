import { ALT_DECORATIVE, FALLBACK_NODE_TYPE, IMAGE_ATTRIBUTES, IMAGE_DEFAULT_LOADING, NODE_TYPE_MAP, TYPES_WITH_DATA_TAG } from "../config/constants.js";
import { assetIdForSrc } from "./images.js";

/**
 * Factories for the individual entries of the payload's `nodes` array.
 *
 * Every shape here was checked field-by-field against elements read out of a live Designer's
 * NavigatorStore. Extra keys are silently dropped by Webflow on paste, missing ones can crash it.
 */

const emptyVisibility = () => ({ conditions: [], keepInHtml: { tag: "False", val: {} } });

/**
 * Attributes that must NOT be copied into `xattr`, because the node already carries them
 * somewhere Webflow renders from. Duplicating them there either fights with the native value or
 * emits the attribute twice.
 */
const RESERVED_ATTRIBUTES = ["class", "style", "id"];

/** Per-type additions to the reserved list. */
const NATIVELY_MAPPED_ATTRIBUTES = {
	Link: ["href"], // lives in data.link.url
	Image: IMAGE_ATTRIBUTES, // live in data.attr
};

/** Map an HTML tag name to its Webflow node type. */
export const mapNodeType = (tagName) => NODE_TYPE_MAP[tagName] || FALLBACK_NODE_TYPE;

/** A run of text. Webflow models text as its own node, referenced by the parent's `children`. */
export const createTextNode = (id, text) => ({
	_id: id,
	text: true,
	v: text,
});

/**
 * A Code Embed carrying raw <style>/<script>/<link> source.
 *
 * `v` is what Webflow renders on the canvas, and it must be the tag SKELETON - NOT the code.
 * Verified against a live Designer:
 *   v = full source        -> Designer crashes ("Something went wrong") on paste
 *   v = ""                 -> paste is a silent no-op, nothing is created
 *   v = "<style></style>"  -> works; data.content keeps the real source
 * A shallow clone keeps the tag and its attributes and drops the body.
 */
const embedNode = (id, skeleton, code) => ({
	_id: id,
	type: "HtmlEmbed",
	tag: "div",
	classes: [],
	children: [],
	v: skeleton,
	data: {
		search: { exclude: true },
		embed: {
			type: "html",
			meta: {
				html: "",
				div: /<div\b/i.test(code),
				script: /<script\b/i.test(code),
				compilable: false,
				iframe: /<iframe\b/i.test(code),
			},
		},
		insideRTE: false,
		content: code, // the verbatim source Webflow publishes
		xattr: [],
		devlink: { runtimeProps: {}, slot: "" },
		displayName: "",
		attr: { id: "" },
		visibility: emptyVisibility(),
	},
});

export const createEmbedNode = (id, element, codeOverride) =>
	// `codeOverride` lets a <style> embed carry only the rules that could not become native
	// Webflow styles, while `v` still comes from the real element so its attributes survive.
	embedNode(id, element.cloneNode(false).outerHTML, codeOverride ?? element.outerHTML);

/**
 * One Code Embed standing in for every <style>/<link> or every <script> on the page
 * (the `mergeEmbeds` option).
 *
 * There is no single source element to clone a skeleton from, so `v` is the bare tag - which is
 * exactly what the skeleton rule asks for. The Navigator label comes from a NODE-level `meta`,
 * a different key from the `data.displayName` every other node carries.
 */
export const createMergedEmbedNode = (id, skeleton, code, displayName) => {
	const node = embedNode(id, skeleton, code);
	node.meta = { displayName };
	return node;
};

/**
 * A regular element node. `children` is returned empty - the traverser fills it as it walks.
 *
 * @param {string} otherClasses  passthrough class string, or null
 */
export const createElementNode = (id, element, wfType, classIds, otherClasses) => {
	const lowerTag = element.tagName.toLowerCase();

	const node = {
		_id: id,
		type: wfType,
		tag: wfType === "DOM" ? "div" : lowerTag,
		classes: classIds,
		children: [],
		data: {
			text: false,
			devlink: { runtimeProps: {}, slot: "" },
			displayName: "",
			attr: { id: element.id || "" },
			xattr: [],
			search: { exclude: false },
			visibility: emptyVisibility(),
		},
	};

	if (TYPES_WITH_DATA_TAG.includes(wfType)) {
		node.data.tag = lowerTag;
	}

	if (wfType === "Link") {
		node.data.button = false;
		node.data.block = "inline";
		node.data.link = { mode: "external", url: element.getAttribute("href") || "#", preload: "none" };
		node.data.eventIds = [];
	}

	if (wfType === "LineBreak") {
		// A LineBreak carries NONE of the usual keys - no devlink, attr, xattr, search or
		// visibility. Its whole `data` is this marker, copied from Webflow's own payload.
		node.data = { sym: { inst: "LineBreak" } };
		return node;
	}

	if (wfType === "List") {
		node.data.list = { type: lowerTag === "ol" ? "ordered" : "list", unstyled: false };
	}

	if (wfType === "ListItem") {
		node.data.list = { type: "item" };
	}

	if (wfType === "Image") {
		// `data.img` must be PRESENT. Verified with variants pasted side by side: omitting it
		// entirely replaces the src with Webflow's grey placeholder, whereas an id that resolves
		// to nothing - including "" - falls back to `data.attr.src`. So `{ id: "" }` is not the
		// same as absent; do not "clean it up".
		//
		// A real id, recovered from a Webflow asset URL, additionally binds the Image to the
		// asset, which is what makes Webflow build a responsive srcset. See images.js.
		node.data.img = { id: assetIdForSrc(element.getAttribute("src") ?? "") };
		node.data.srcsetDisabled = false;
		node.data.sizes = [];
		// Webflow's own Image payload has no `text` key.
		delete node.data.text;

		// These publish from `data.attr`, unlike every other native type, whose non-native
		// attributes go to `xattr`. NATIVELY_MAPPED_ATTRIBUTES keeps them out of that list.
		IMAGE_ATTRIBUTES.forEach((name) => {
			const value = element.getAttribute(name);
			if (value !== null) node.data.attr[name] = value;
		});

		// `alt=""` is HTML for "decorative, skip me", and a MISSING alt leaves the Designer's Alt
		// Text field simply blank - no better for a screen reader, and invisible as a decision.
		// Both take Webflow's decorative sentinel; only real alt text survives as itself.
		if (!node.data.attr.alt) node.data.attr.alt = ALT_DECORATIVE;

		// An <img> that says nothing about loading gets Webflow's own default rather than none,
		// which would leave the Designer on "Auto: defaults to browser" and load every image
		// eagerly. A source that DOES specify `loading` keeps whatever it asked for.
		node.data.attr.loading ??= IMAGE_DEFAULT_LOADING;
	}

	if (wfType === "DOM") {
		// A Custom Element has its own attribute list and none of the Webflow-native keys.
		node.data = {
			tag: lowerTag,
			attributes: [],
			text: false,
			slot: "",
			visibility: emptyVisibility(),
		};
		Array.from(element.attributes).forEach((attr) => {
			// style and class are handled by the style engine, everything else maps straight over.
			if (attr.name !== "style" && attr.name !== "class") {
				node.data.attributes.push({ name: attr.name, value: attr.value });
			}
		});
		// A Custom Element publishes `class` ONLY from `attributes`; a class written to `xattr`
		// is silently dropped from the published markup.
		if (otherClasses) {
			node.data.attributes.push({ name: "class", value: otherClasses });
		}
	} else {
		// Every other element type publishes `class` from `xattr`, merged with its style classes.
		// Webflow puts the class first in its own payloads, so match that ordering.
		if (otherClasses) {
			node.data.xattr.push({ name: "class", value: otherClasses });
		}
		// Everything else the author wrote (aria-*, data-*, role, ...) becomes a custom attribute.
		// Without this, native elements silently lose every attribute except class.
		const reserved = new Set([...RESERVED_ATTRIBUTES, ...(NATIVELY_MAPPED_ATTRIBUTES[wfType] ?? [])]);
		Array.from(element.attributes).forEach((attr) => {
			if (!reserved.has(attr.name.toLowerCase())) {
				node.data.xattr.push({ name: attr.name, value: attr.value });
			}
		});
	}

	return node;
};

/**
 * Plain Block used to give a multi-root payload a single root.
 *
 * Webflow pastes external payloads through its "cross-site" path, which reifies the whole payload
 * into ONE subtree. More than one top-level node throws "Subtree reification resulted in more
 * than one root!" inside reifyElementSubtree and takes the whole Designer down with a
 * "Something went wrong" dialog.
 */
/**
 * Paragraph wrapped around top-level text that was written without any tag around it.
 *
 * A text node is a CHILD-only shape in Webflow - no `type`, no `tag` - so left as the payload's
 * root it is not an element at all. Pasting bare text has to produce something that can hold it,
 * and a Paragraph is what the same text would be in a document.
 */
export const createParagraphNode = (id, childIds) => ({
	_id: id,
	type: "Paragraph",
	tag: "p",
	classes: [],
	children: childIds,
	data: {
		// Only ever built to hold a run of text, so its content is a text flow by construction.
		text: true,
		devlink: { runtimeProps: {}, slot: "" },
		displayName: "",
		attr: { id: "" },
		xattr: [],
		search: { exclude: false },
		visibility: emptyVisibility(),
	},
});

/**
 * A Div Block used as a TEXT element, for a run of loose text that sits beside block siblings.
 *
 * `<div>a<div>x</div></div>` cannot keep "a" as a direct child: the outer div has a block child,
 * so it is a container, and a container publishes elements rather than text. Webflow's own answer
 * is a text-type Div Block, which is what this builds.
 */
export const createTextBlockNode = (id) => {
	const node = createWrapperNode(id, []);
	node.data.text = true;
	return node;
};

export const createWrapperNode = (id, childIds) => ({
	_id: id,
	type: "Block",
	tag: "div",
	classes: [],
	children: childIds,
	data: {
		text: false,
		devlink: { runtimeProps: {}, slot: "" },
		displayName: "",
		attr: { id: "" },
		xattr: [],
		search: { exclude: false },
		visibility: emptyVisibility(),
		tag: "div",
	},
});
