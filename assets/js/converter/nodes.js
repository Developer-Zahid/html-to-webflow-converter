import { FALLBACK_NODE_TYPE, NODE_TYPE_MAP, TYPES_WITH_DATA_TAG } from "../config/constants.js";

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
export const createEmbedNode = (id, element, codeOverride) => {
	// `codeOverride` lets a <style> embed carry only the rules that could not become native
	// Webflow styles, while `v` still comes from the real element so its attributes survive.
	const code = codeOverride ?? element.outerHTML;
	return {
		_id: id,
		type: "HtmlEmbed",
		tag: "div",
		classes: [],
		children: [],
		v: element.cloneNode(false).outerHTML,
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
	};
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

	if (wfType === "List") {
		node.data.list = { type: lowerTag === "ol" ? "ordered" : "list", unstyled: false };
	}

	if (wfType === "ListItem") {
		node.data.list = { type: "item" };
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
