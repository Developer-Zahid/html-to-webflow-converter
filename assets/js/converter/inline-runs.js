import { INLINE_TAGS } from "../config/constants.js";

/**
 * Splitting a child list into text flow vs. block-level structure.
 *
 * Webflow has nowhere to put loose text that sits next to block elements: a container Block
 * publishes its children as elements, and a bare text node is not one. So wherever text and
 * block siblings mix, the text has to be given an element of its own - a Paragraph at the top
 * level, a text-type Div Block inside a container.
 *
 * Both callers need the same grouping, which is why it lives here rather than in either of them.
 */

/** Text, inline formatting and comments all flow INSIDE a text element rather than beside one. */
export const isInlineSource = (node) =>
	node.nodeType === Node.TEXT_NODE ||
	node.nodeType === Node.COMMENT_NODE ||
	(node.nodeType === Node.ELEMENT_NODE && INLINE_TAGS.includes(node.tagName));

/**
 * Whether these nodes carry text a reader would actually see. The whitespace and newlines
 * BETWEEN block elements are text nodes too, and wrapping those would litter the Navigator with
 * empty text blocks.
 */
export const carriesText = (nodes) => nodes.some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());

/** @returns {boolean} whether any child is a block-level element, which makes this a container */
export const hasBlockChild = (nodes) => nodes.some((n) => n.nodeType === Node.ELEMENT_NODE && !isInlineSource(n));

/**
 * A Link sitting IN a text flow is a plain inline link, not an inline-BLOCK. Webflow's own
 * payload writes `block: ""` for one; the standalone default of "inline" publishes it with
 * `w-inline-block`, which stops the link wrapping mid-phrase and shifts its baseline.
 *
 * @param {object[]} nodes  the flat payload node list
 * @param {string[]} childIds  ids of the text flow's direct children
 */
export const relaxLinksInTextFlow = (nodes, childIds) => {
	childIds.forEach((childId) => {
		const child = nodes.find((n) => n._id === childId);
		if (child?.type === "Link") child.data.block = "";
	});
};

/**
 * Split a child list into alternating inline / block runs, preserving order.
 * @returns {{inline: boolean, nodes: Node[]}[]}
 */
export const groupInlineRuns = (childNodes) => {
	const groups = [];
	for (const node of childNodes) {
		const inline = isInlineSource(node);
		const last = groups[groups.length - 1];
		if (last && last.inline === inline) last.nodes.push(node);
		else groups.push({ inline, nodes: [node] });
	}
	return groups;
};
