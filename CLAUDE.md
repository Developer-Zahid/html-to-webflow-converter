# HTML to Webflow Converter

A single-page, dependency-free web app that converts an HTML snippet into a
`@webflow/XscpData` clipboard payload, so it can be pasted straight into the Webflow Designer
as real Webflow elements.

No build step. Open `index.html` over **http** (Live Server on `:5500` is what this project
uses). It will **not** work over `file://` — ES modules need a real origin.

---

## Architecture

```
index.html                      markup + Tailwind CDN + <script type="module">
assets/js/
  main.js                       entry — boots the app
  app.js                        controller: state, wires input <-> converter <-> clipboard
  config/
    constants.js                node-type map, panel-property allowlist, form defaults
    default-html.js             the demo snippet the editor is seeded with
  converter/
    index.js                    convertHtmlToWebflow(html, options) -> payload   <-- PUBLIC API
    traverse.js                 recursive DOM walk, delegates forms + embeds
    nodes.js                    node factories (element, text, embed, wrapper)
    stylesheet.js               splits <style> into native styles vs leftover CSS
    embed-merge.js              the `mergeEmbeds` option: one CSS + one JS Code Embed
    images.js                   native Image vs Custom Element, by src (publish-safety)
    inline-runs.js              text-flow vs container: where loose text needs a wrapper
    style-registry.js           the payload's `styles` array + per-element class ids
    inline-css.js               declaration serialization (shorthands, @raw wrapping)
    element-styles.js           shared "classes + passthrough class attr" helper
    class-names.js              Webflow class-name normalization
    form.js                     native Webflow form subtrees
    ids.js                      newId() + deterministic idFromSeed()
  ui/
    elements.js                 the only place that touches page element ids
    view.js                     all DOM writes (output, error, copy button)
    clipboard.js                the `application/json` copy hijack
```

**`converter/index.js` is pure** — HTML string in, payload object out. It knows nothing about
the UI, so it is reusable from a CLI, a test, or a browser extension. The only browser
dependency in the core is `inline-css.js`, which borrows the browser's CSS parser to expand
shorthands.

### Options

```js
convertHtmlToWebflow(html, { nativeForms: true, nativeImages: true, mergeEmbeds: true })
```

- `nativeForms` (default `false`, wired to the "Native Forms" toggle in the UI) — convert
  `<form>` and its fields into native Webflow form elements instead of Custom Elements.
- `nativeImages` (default `false`, wired to the "Native Images" toggle) — make **every** `<img>`
  a native Image, substituting Webflow's placeholder for any `src` that would not survive
  publish. Off, only images already on `cdn.prod.website-files.com` go native and the rest stay
  Custom Elements with their URL intact. See `converter/images.js`.
- `mergeEmbeds` (default `false`, wired to the "Merge Embeds" toggle) — fold every `<style>` and
  `<link>` into a single Code Embed and every `<script>` into another, instead of emitting one
  embed per tag. The two are named "CSS Code Embed" / "JS Code Embed" in the Navigator via a
  node-level `meta.displayName`, and are placed around the content — CSS first, JS last — the way
  a document orders them. `<noscript>` is in neither bucket (it holds markup, not CSS or JS) and
  keeps its own embed in place. Off by default because one-embed-per-tag preserves document order
  exactly.

Stylesheet adoption (see below) is **always on**, not behind a toggle.

---

## What the converter does

| HTML | Webflow |
| --- | --- |
| `div`, `header`, `footer`, `nav`, `main`, `article`, `aside`, `address`, `figure` | `Block` with `data.tag` |
| `section` | `Section` (its own element type) |
| `h1`–`h6`, `p`, `a`, `ul`/`ol`, `li`, `strong`/`b`, `em`/`i`, `blockquote` | native types |
| `code`, `sup`, `sub`, `span` | `InlineCode`, `Superscript`, `Subscript`, `Span` |
| `br` | `LineBreak` — `data` is only `{ sym: { inst: "LineBreak" } }` |
| `img` on `cdn.prod.website-files.com` | `Image` (native) |
| `img` anywhere else | Custom Element — or a placeholder `Image` when `nativeImages` is on |
| `style`, `script`, `link`, `noscript` | `HtmlEmbed` (Code Embed) |
| everything else (`form`, `table`, `svg`, `figcaption`…) | Custom Element (`type: "DOM"`) |
| `<form>` + fields, when `nativeForms` is on | `FormWrapper` → `FormForm` + Success/Error |

**Loose text always gets an element of its own.** A text node is a child-only shape — no `type`,
no `tag` — so it can only live inside an element that is itself a text flow. Wherever text sits
beside block-level siblings, it gets wrapped:

| where | wrapper |
| --- | --- |
| top level (no tag at all) | `Paragraph` |
| inside a container, beside block children | text-type `Block` (`data.text: true`) |

Whole *runs* are wrapped rather than each text node separately, so `Some <a href="#">link</a>
text` stays one wrapper instead of splitting into three siblings (`INLINE_TAGS` decides what a
run absorbs). Runs carrying no visible text are left alone, which is what stops the newlines
between block elements becoming empty text blocks. Shared logic lives in `inline-runs.js`.

The **first** class on an element becomes a real Webflow style block; every remaining class is
passed through verbatim as a custom `class` attribute so external frameworks (Tailwind) still
match.

Elements that would paste as **nothing useful are skipped entirely**, because Webflow has no
"empty" state for them — they arrive as a real node the user then has to delete: an `<img>` with
no `src` (it would render Webflow's placeholder), and a code tag with nothing to publish
(`<style></style>`, `<script>  </script>`, a `<link>` with no `href`). A `<script src>` and a
`<link href>` are empty by nature and are kept — their payload is the attribute.

---

## Hard-won Webflow rules

Everything here was established by probing a live Designer. Each one fails **silently or
catastrophically** if you get it wrong. Full detail: `docs/webflow-clipboard-format.md`.

1. **Exactly one root node.** More than one top-level node crashes the whole Designer
   ("Something went wrong", `Subtree reification resulted in more than one root!`). Multiple
   roots are wrapped in a `Block`.
2. **`HtmlEmbed.v` must be the tag skeleton** (`<style></style>`), not the code. Full source
   crashes the Designer; `""` makes the paste a silent no-op. `data.content` holds the source.
3. **`class` lives in two different places.** Custom Elements (`type: "DOM"`) publish `class`
   only from `data.attributes`; every other type publishes it from `data.xattr`.
4. **`@raw<|value|>`** routes a declaration into the Style panel's *Custom properties* section.
   Needed when the property has no panel control **or** the value doesn't fit one. Written
   plain in either case, the value renders but is **invisible** in the Designer.
5. **Style blocks are matched by `_id`, not name.** Ids are derived deterministically from the
   class name (`idFromSeed`) so re-pasting the same HTML is idempotent.
6. **Whitespace between inline elements is significant.** Trimming text nodes glues words to
   neighbouring `<strong>`/`<em>`/`<a>`.
7. **A native Image's `src` is rewritten onto Webflow's CDN at PUBLISH**, keeping only the path,
   so an external URL renders perfectly on the canvas and 404s on the live site. There is no
   warning anywhere in the Designer. The rewrite belongs to the Image element *type* — a Custom
   Element publishes its `src` untouched — so only `cdn.prod.website-files.com` URLs are safe as
   native Images and everything else stays a Custom Element.
8. **An Image needs `data.img = { id: "" }` to keep its `src` on the canvas.** Empty is not the
   same as absent: omitting `data.img`, or giving a real asset id, both swap in the placeholder.
9. **Verifying on the canvas is not verifying.** Anything URL-shaped has to be published and
   loaded live — rule 7 passed every possible in-Designer check.

---

## Known limitations / open items

### CSS variables cannot be mapped to Webflow variables

`var(--brand)` in source CSS stays a literal `var()` string. Webflow stores a variable
reference as a **binding to a variable id**, not as CSS text — and those ids live inside the
target site. A standalone converter cannot see them, so there is no way to produce a real
binding from HTML alone.

Current behaviour: a panel-backed property whose value contains `var()` is wrapped in
`@raw<|…|>`, so it lands in *Custom properties* — visible, editable, and the CSS still
resolves at runtime as long as the variable is defined somewhere on the site. That is the
correct outcome for a converter; the alternative (plain) would make it invisible in the UI.

Bridging this would require reading `CssVariablesStore` from inside the Designer (a browser
extension or Designer Extension), which is a different product shape.

### Other gaps

- **Only media queries that exactly match Webflow's breakpoint widths are adopted** into
  breakpoint variants (`max-width: 991/767/479px` → `medium`/`small`/`tiny`,
  `min-width: 1280/1440/1920px` → `large`/`xl`/`xxl`; a `screen and` / `only screen and`
  prefix is tolerated). Any other media query — unusual widths, ranges, feature queries like
  `(hover: hover)`, `print` — stays whole in the Code Embed, as does any non-adoptable rule
  inside a matching query (re-wrapped in its `@media`). Variant keys verified against a live
  Designer; see `docs/webflow-clipboard-format.md`.
- **Only 4 pseudo-states** are adopted: `:hover`, `:active`, `:focus`, `:focus-visible`
  (at any breakpoint — `medium_hover` etc.).
  Others (`:visited`, `:first-child`, pseudo-*elements*) stay in the embed.
- **Leftover CSS keeps the author's original text.** Rules are sliced out of the source by a
  hand-rolled top-level splitter rather than printed from the CSSOM, because `rule.cssText`
  rewrites declarations (`border-top: none` → three longhands). The CSSOM is used only to
  *classify* each slice. Comments *between* rules are dropped once anything in the block is
  adopted — a `/* medium breakpoint */` left stranded above a rule that moved into the Style
  panel is worse than no comment. If *nothing* is adopted the whole original block is kept,
  comments and all.
- **Unsupported form input types** (`file`, `date`, `range`, `color`, `hidden`) fall back to
  Custom Elements — Webflow has no native field for them.
- **An external `img` cannot be a native Image.** Publish rewrites the `src` onto Webflow's CDN
  (rule 7), so it stays a Custom Element, whose `src` publishes verbatim — confirmed live. The
  cost is that it is opaque in the Designer: no Image settings panel, no alt-text control.
- **A Webflow asset URL binds to the real asset.** The asset id lives inside the URL's filename
  (`…/<siteId>/<assetId>_<name>.jpg`), so `data.img.id` is recovered from the `src` and Webflow
  generates the full responsive `srcset` — no `assets[]` descriptor needed. If the id does not
  resolve on the target site it degrades to the unbound case rather than breaking.
- **A native Image with no recoverable asset id** (`data.img.id` is `""`) still renders, but
  Webflow builds no `srcset`, and the Settings panel's image chip reads "placeholder.svg,
  140x140px" beside a correctly rendering picture. *Choose Image…* binds a real asset.
- **`nativeImages` substitutes a placeholder that is itself broken once published.** Webflow's
  own placeholder URL gets the same rewrite and returns AccessDenied on the live site. That is
  Webflow doing it to its own asset, and it is the point of the option: an obviously-unset image
  to replace in the Designer, not something to publish as-is.
- **`data.text` is `true` when the content is a text FLOW** — text plus any inline formatting
  (`INLINE_TAGS`). Only a block-level child makes the element a container again. On a `Block`
  this is what turns it into a text element: the Navigator labels it with its own text instead
  of "Div Block", and the Settings panel grows a *Text* field. A `Link` in that flow also drops
  to `data.block: ""`, so it publishes as a plain inline link rather than `w-inline-block`.
  Deliberate deviation: Webflow **omits** the key entirely on a `Paragraph` holding text, while
  this converter writes `true` there too. Verified harmless by pasting — one rule for every type
  is easier to reason about than a per-type table — but that is why the two payloads differ.

---

## Testing against a live Designer

See `docs/webflow-clipboard-format.md` for the full method. The short version:

1. Serve the app over http and open the Designer in another tab.
2. **Foreground the converter tab** (a screenshot does this) before clicking Copy —
   `execCommand('copy')` is blocked on a hidden tab and fails silently.
3. Switching tabs **clears the Designer's selection**. Re-select before pasting.
4. A paste with no valid selection is a **silent no-op** — never infer success from the
   absence of a crash. Assert on the canvas DOM or a node count.
5. `NavigatorStore` is stale until a `NODE_CLICKED` rebuild — click any element before reading.

Useful reads inside the Designer:

```js
_webflow.getStoreState('StyleBlockStore').styleBlocks.toArray().map(b => b.get('name'))
document.getElementById('site-iframe-next').contentDocument   // the canvas
```
