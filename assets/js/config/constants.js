/**
 * Shared constants for the conversion engine.
 *
 * Most of the values here were established by probing a live Webflow Designer, not from
 * documentation. Webflow can change any of them without notice - when a paste starts failing,
 * this file is the first place to re-verify.
 */

// Webflow stamps every style block with the id of the user who created it. Any well-formed id
// is accepted; this one comes from real captured clipboard payloads.
export const CREATED_BY = "57545639e00e5fe22ed713e3";

// Map standard HTML tags to Webflow node types.
export const NODE_TYPE_MAP = {
	// A Block carries its HTML tag in `data.tag`, and Webflow's Tag dropdown accepts a fixed set
	// of semantic tags. Mapping them here keeps them NATIVE elements (a <nav> shows up in the
	// Navigator as "Navigation", stays editable in the Settings panel, and keeps the Style panel)
	// instead of becoming opaque Custom Elements. See SEMANTIC_BLOCK_TAGS below.
	DIV: "Block",
	HEADER: "Block",
	FOOTER: "Block",
	NAV: "Block",
	MAIN: "Block",
	ARTICLE: "Block",
	ASIDE: "Block",
	ADDRESS: "Block",
	FIGURE: "Block",
	// SECTION has its own dedicated element type rather than being a tagged Block.
	SECTION: "Section",
	H1: "Heading",
	H2: "Heading",
	H3: "Heading",
	H4: "Heading",
	H5: "Heading",
	H6: "Heading",
	P: "Paragraph",
	A: "Link",
	UL: "List",
	OL: "List",
	LI: "ListItem",
	STRONG: "Strong",
	B: "Strong",
	EM: "Emphasized", // "Emphasis" in the UI, but "Emphasized" in the JSON schema
	I: "Emphasized",
	BLOCKQUOTE: "Blockquote",
	// Inline formatting types, read off a Webflow payload for a div holding mixed rich text.
	// Without these a <code>/<sup>/<span> becomes an opaque Custom Element inside otherwise
	// editable text.
	CODE: "InlineCode",
	SUP: "Superscript",
	SUB: "Subscript",
	SPAN: "Span",
	// A <br> is a real Webflow element, not a Custom Element - and its `data` is nothing but the
	// `sym` marker, see createElementNode.
	BR: "LineBreak",
	// IMG is deliberately absent: whether it can be a native Image depends on its SRC, not just
	// its tag, so the decision is made per element in converter/images.js. Falling through to a
	// Custom Element is the safe default - that publishes the src verbatim.
};

/**
 * Attributes a native Image publishes from `data.attr` - where its Settings panel reads them -
 * rather than from `xattr` like every other native type's non-native attributes.
 */
export const IMAGE_ATTRIBUTES = ["src", "alt", "width", "height", "loading"];

/**
 * Webflow's asset CDN.
 *
 * On PUBLISH, Webflow rewrites a native Image's src to this host, keeping only the PATH:
 * `https://picsum.photos/seed/x/100/200` goes out as
 * `https://cdn.prod.website-files.com/seed/x/100/200`, which does not exist. An external URL in a
 * native Image is therefore a broken image on the live site no matter how well it renders on the
 * canvas - which is exactly how this was missed the first time round.
 *
 * A URL already on this host is the one safe case: the rewrite becomes a no-op.
 */
export const WEBFLOW_ASSET_URL_PREFIX = "https://cdn.prod.website-files.com/";

/** Webflow's own "no image chosen" graphic, for a src that cannot survive publish. */
export const WEBFLOW_PLACEHOLDER_IMAGE = "https://d3e54v103j8qbb.cloudfront.net/plugins/Basic/assets/placeholder.60f9b1840c.svg";

/** The asset id Webflow itself writes for that placeholder, straight from its own payload. */
export const WEBFLOW_PLACEHOLDER_ASSET_ID = "plugins/Basic/assets/placeholder.svg";

/**
 * A Webflow asset URL carries the asset id in its filename:
 *   https://cdn.prod.website-files.com/<siteId>/<assetId>_<originalName>
 * Recovering it lets an Image BIND to the real asset, which is what makes Webflow generate a
 * responsive srcset. Verified: a derived id produced a 7-entry srcset with no `assets[]` entry in
 * the payload at all, and an id that does not exist on the target site is harmless - Webflow
 * falls back to `data.attr.src`.
 */
export const WEBFLOW_ASSET_ID_IN_URL = /^https:\/\/cdn\.prod\.website-files\.com\/[^/]+\/([0-9a-f]{24})_/i;

/**
 * Reserved `alt` values from Webflow's own Image payloads. `alt=""` in HTML means "decorative",
 * which is exactly what the first one encodes - so the mapping is faithful, not invented.
 */
export const ALT_DECORATIVE = "__wf_reserved_decorative";
export const ALT_INHERIT = "__wf_reserved_inherit";

/**
 * What an Image gets when the source <img> carries no `loading` attribute.
 *
 * Webflow's own default payload writes "lazy", and leaving the key off instead gives the Designer
 * "Auto: defaults to browser" - a weaker default, since a browser only lazy-loads when the author
 * asks. Matching Webflow is both the faster page and the less surprising Settings panel.
 */
export const IMAGE_DEFAULT_LOADING = "lazy";

/**
 * The exact tags Webflow's "Tag" dropdown offers for a Block (Settings panel -> Tag). Anything
 * outside this list must NOT be emitted as a Block - it has to fall through to a Custom Element,
 * because the Designer has no UI to represent it and the tag would not round-trip.
 *
 * Kept as its own export so it can be asserted against NODE_TYPE_MAP in a test, and so the next
 * person adding a tag can see what the constraint actually is.
 */
export const SEMANTIC_BLOCK_TAGS = ["div", "header", "footer", "nav", "main", "section", "article", "aside", "address", "figure"];

// Everything else (form, table, svg, figcaption, ...) becomes a Custom Element.
export const FALLBACK_NODE_TYPE = "DOM";

/**
 * Tags that flow INSIDE a paragraph rather than sitting beside one.
 *
 * Only consulted at the TOP level, to work out how much a run of untagged text pulls in with it
 * when it gets a Paragraph wrapped around it - see convertHtmlToWebflow. Inside an element the
 * normal walk already handles them.
 */
export const INLINE_TAGS = ["A", "STRONG", "B", "EM", "I", "SPAN", "CODE", "SMALL", "ABBR", "MARK", "SUB", "SUP", "U", "S", "BR"];

// Types that carry their HTML tag in `data.tag`. Strong/Emphasized are deliberately absent -
// they have no `tag` in Webflow's schema and it is silently dropped on paste.
export const TYPES_WITH_DATA_TAG = ["Block", "Section", "Heading", "List", "Blockquote"];

// Tags that carry raw code rather than content. Webflow has exactly one element that can hold
// them - the Code Embed (HtmlEmbed) - so they must not go down the normal element path, where
// <style> would become a Custom Element with tag "style" and its CSS would end up as a stray
// text node.
export const EMBED_TAGS = ["STYLE", "SCRIPT", "NOSCRIPT", "LINK"];

/**
 * How the `mergeEmbeds` option buckets those tags. A page with several <style> and <script> tags
 * otherwise produces a Code Embed for each one, which clutters the Navigator.
 *
 * NOSCRIPT is deliberately in neither bucket: it holds fallback MARKUP, not CSS or JS, so folding
 * it into either would be wrong. It keeps its own embed, in place.
 */
export const CSS_EMBED_TAGS = ["STYLE", "LINK"];
export const JS_EMBED_TAGS = ["SCRIPT"];

/**
 * Navigator labels for the two merged embeds. Webflow reads an element's Navigator name from a
 * NODE-level `meta.displayName` - NOT `data.displayName`, which stays "".
 */
export const MERGED_EMBED_NAMES = {
	css: "CSS Code Embed",
	js: "JS Code Embed",
};

/**
 * Authoring hook: `data-wf-displayName="Hero"` names the element in Webflow's Navigator.
 *
 * Stored lowercase because that is what the HTML parser does to attribute names - the source may
 * spell it in any case. It is a directive to this converter, not content, so it is stripped from
 * the published attributes rather than passed through.
 */
export const DISPLAY_NAME_ATTRIBUTE = "data-wf-displayname";

// Shorthands the Designer struggles with. The browser expands them into longhands for us; these
// raw shorthand names are then dropped so only the longhands survive.
export const CSS_SHORTHANDS = ["margin", "padding", "border", "border-radius", "border-width", "border-color", "border-style", "background", "font"];

/**
 * The opposite case: shorthands Webflow's panel writes ITSELF, so expanding them into longhands
 * would push the value into Custom properties instead of its control. Each maps to the longhands
 * the browser expands it into, which are then skipped.
 *
 * Verified from a reference element: Webflow serialized `overflow: hidden` and
 * `white-space: nowrap` - never `overflow-x` or `white-space-collapse`, which is what the
 * browser's CSSOM hands back.
 */
export const PREFERRED_SHORTHANDS = {
	overflow: ["overflow-x", "overflow-y"],
	"white-space": ["white-space-collapse", "text-wrap-mode", "text-wrap-style", "text-wrap"],
	// Not a Webflow-panel shorthand - Webflow has no animation control at all, so this lands in
	// Custom properties either way. It is here because the browser explodes ONE authored
	// `animation:` into ELEVEN longhands, filling the panel with animation-timeline and
	// animation-range-end noise. The shorthand round-trips losslessly, so one line it is.
	// NOTE: `transition` deliberately does NOT get the same treatment - its round trip DROPS the
	// timing function ("transform .25s ease" comes back as "transform 0.25s"), and its longhands
	// are panel-backed anyway.
	animation: [
		"animation-duration",
		"animation-timing-function",
		"animation-delay",
		"animation-iteration-count",
		"animation-direction",
		"animation-fill-mode",
		"animation-play-state",
		"animation-name",
		"animation-timeline",
		"animation-range-start",
		"animation-range-end",
	],
};

/**
 * Properties the Style panel cannot show AT ALL - not on a control, not even as a Custom
 * properties row. Written into `styleLess` they still render on the canvas and publish fine, but
 * they are invisible and uneditable in the Designer, so the converter leaves them in the Code
 * Embed as CSS instead. That keeps them visible, editable, and applied.
 *
 * Established by pasting probe elements carrying 41 different declarations into a live Designer
 * and reading back what the panel did with each. Every other one landed somewhere the user can
 * see it - most as a Custom properties row, the `background-*` longhands in the Backgrounds
 * section, the `transition-*` longhands collapsed into one `transition` row. These two are the
 * only ones that vanished, and the shape is consistent: both are shorthands Webflow models as a
 * LIST built from the longhands (background layers, the transition list), so the shorthand itself
 * has no slot to go in. Matching the user's report that typing `background` into Custom
 * properties offers only `background-color`, `background-clip` and friends - never `background`.
 *
 * Only reachable via the pending-substitution passthrough in inline-css.js: without a `var()` in
 * the value the CSSOM expands both into longhands, which are fine.
 */
export const EMBED_ONLY_PROPERTIES = ["background", "transition"];

/**
 * Property renames applied after expansion. Webflow's gap control writes the legacy grid names,
 * so the modern ones the browser produces have to be mapped back or they land in Custom
 * properties. Verified: a flex element with a gap serialized as grid-column-gap / grid-row-gap.
 */
export const PROPERTY_ALIASES = {
	"column-gap": "grid-column-gap",
	"row-gap": "grid-row-gap",
	// Webflow's "Decoration & underline > Line" control holds ONLY the line keyword, under the
	// shorthand name. Handing it the compound shorthand the CSSOM builds
	// ("underline 5px dotted rgb(...)") leaves that dropdown blank, while the sibling
	// -style/-color/-thickness declarations still populate their own fields.
	"text-decoration-line": "text-decoration",
};

// Sub-properties the browser invents when expanding a shorthand. They carry no authored intent,
// and Webflow stores styleLess verbatim - so left in they clutter the Style panel, and the
// `initial` resets can override what the element would otherwise inherit. `background: red`
// alone expands to 8 of these.
export const NOISE_DEFAULTS = {
	"border-image-source": "none",
	"border-image-slice": "100%",
	"border-image-width": "1",
	"border-image-outset": "0",
	"border-image-repeat": "stretch",
	"font-variant-caps": "normal",
	"font-variant-ligatures": "normal",
	"font-variant-numeric": "normal",
	"font-variant-east-asian": "normal",
	"font-variant-alternates": "normal",
	"font-variant-position": "normal",
	"font-variant-emoji": "normal",
	"font-language-override": "normal",
	"font-feature-settings": "normal",
	"font-variation-settings": "normal",
	"font-size-adjust": "none",
	"font-kerning": "auto",
	"font-optical-sizing": "auto",
	"font-stretch": "normal",
	"transition-behavior": "normal",
};

/**
 * CSS properties that have a dedicated control in Webflow's Style panel.
 *
 * These are written into `styleLess` as plain `prop: value`. EVERYTHING ELSE must be wrapped as
 * `prop: @raw<|value|>` so it lands in the panel's "Custom properties" section. Verified on a
 * live Designer:
 *   - plain + panel-backed  -> edits in its own control (Typography, Spacing, ...)
 *   - plain + NOT backed    -> CSS still renders, but the value is INVISIBLE in the Style panel
 *   - @raw + anything       -> CSS renders and the value shows under "Custom properties"
 *
 * So the failure modes are asymmetric, and this list is deliberately conservative: omitting a
 * property just moves it to Custom properties (visible, editable, correct CSS), whereas wrongly
 * including one makes it disappear from the UI. When in doubt, leave it out.
 *
 * Entries below marked (v) were observed plain in Webflow's own serialization - most from a
 * reference element with every UI-settable style applied. The rest are their symmetric longhands
 * and controls that only appear for other element types or display modes (grid tracks, flex
 * child sizing, object-fit), so a single reference element cannot exercise them.
 *
 * NOTE: `gap` / `row-gap` / `column-gap` are deliberately absent - Webflow's gap control writes
 * the legacy `grid-column-gap` / `grid-row-gap` names instead.
 */
export const PANEL_STYLE_PROPERTIES = [
	// Layout
	"display", // v
	"flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis", "order", // flex-direction/wrap (v)
	"justify-content", "align-items", "align-content", "align-self", // justify-content, align-items (v)
	"grid-template-columns", "grid-template-rows", "grid-template-areas",
	"grid-auto-columns", "grid-auto-rows", "grid-auto-flow", "grid-area",
	"grid-column-start", "grid-column-end", "grid-row-start", "grid-row-end",
	"grid-column-gap", "grid-row-gap", // v
	"float", "clear", "columns", "column-count", "column-span",
	"column-rule-color", "column-rule-style", "column-rule-width",

	// Spacing
	"margin", "margin-top", "margin-right", "margin-bottom", "margin-left", // longhands v
	"padding", "padding-top", "padding-right", "padding-bottom", "padding-left", // v

	// Size
	"width", "height", "min-width", "min-height", "max-width", "max-height", // v
	"overflow", "box-sizing", "aspect-ratio", // v
	"overflow-x", "overflow-y", "object-fit", "object-position",

	// Position
	"position", "top", "right", "bottom", "left", "z-index", // position, z-index (v)

	// Typography
	"color", "font-family", "font-size", "font-weight", "font-style", // v
	"line-height", "letter-spacing", "text-align", // v
	"text-transform", "text-indent", "text-overflow", "text-shadow", // v
	"text-decoration", "text-decoration-color", "text-decoration-style", // v
	"text-decoration-thickness", "text-decoration-skip-ink", // v
	"text-underline-offset", "text-underline-position", // v
	"direction", "white-space", "word-break", "overflow-wrap", // v
	"list-style-type",
	"-webkit-text-stroke-color", "-webkit-text-stroke-width", // v

	// Backgrounds
	"background-color", "background-image", "background-clip", // v
	"background-position", "background-size", "background-repeat",
	"background-attachment", "background-origin",

	// Borders
	"border", "border-width", "border-style", "border-color",
	"border-top-width", "border-top-style", "border-top-color", // v
	"border-right-width", "border-right-style", "border-right-color", // v
	"border-bottom-width", "border-bottom-style", "border-bottom-color", // v
	"border-left-width", "border-left-style", "border-left-color", // v
	"border-radius", "border-top-left-radius", "border-top-right-radius", // v
	"border-bottom-left-radius", "border-bottom-right-radius", // v
	"outline", "outline-color", "outline-style", "outline-width", "outline-offset",

	// Effects
	"opacity", "box-shadow", "filter", "backdrop-filter", "mix-blend-mode", // v
	"transform", "transform-origin", // v
	"perspective", "perspective-origin", "backface-visibility", // v
	"transition-property", "transition-duration", "transition-timing-function", // v
	"cursor", "pointer-events", // v
	"transform-style", "transition", "transition-delay",
];

/**
 * Value shapes Webflow's typed controls cannot hold, even for a property that HAS a control.
 *
 * Verified from a reference element where every UI-settable style was applied: `padding-left` and
 * `color` are both panel-backed, yet came back as `@raw<|calc(2 * 1rem)|>` and
 * `@raw<|color-mix(...)|>`. The others listed here are the same class of computed/dynamic value.
 *
 * Deliberately NOT matched: `linear-gradient()`, `cubic-bezier()`, `sepia()`, `skew()` and
 * friends - those are serialized plain, because the panel's own pickers produce them.
 */
export const UNREPRESENTABLE_VALUE = /(?:^|[\s(,])(?:calc|var|clamp|min|max|color-mix|env|attr|light-dark)\(/i;

/**
 * <input type="..."> values Webflow's FormTextInput can represent. Anything outside this list
 * (file, date, range, color, hidden, ...) has no native equivalent and falls through to a Custom
 * Element rather than being force-fitted into a text input.
 */
export const TEXT_INPUT_TYPES = ["text", "email", "password", "tel", "number", "url", "search"];

/** Defaults for the native-form conversion, matching Webflow's own "Default form". */
export const FORM_DEFAULTS = {
	formName: "Email Form",
	inputMaxLength: 256,
	textareaMaxLength: 5000,
	submitLabel: "Submit",
	waitLabel: "Please wait...",
	successText: "Thank you! Your submission has been received!",
	errorText: "Oops! Something went wrong while submitting the form.",
	selectOptions: [{ t: "Select one...", v: "" }],
};

// Debounce for re-converting as the user types, in milliseconds.
export const INPUT_DEBOUNCE_MS = 500;

// How long the Copy button stays in its "Copied" state, in milliseconds.
export const COPIED_FEEDBACK_MS = 2000;
