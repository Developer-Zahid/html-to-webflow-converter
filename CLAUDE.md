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
    class-patterns.js           user globs: which names mean "combo" / "utility"
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
- `comboClassPatterns` / `utilityClassPatterns` (default `""`, wired to the two "Class name
  patterns" textareas) — newline- or comma-separated globs where `*` matches anything, telling
  the converter what a project's naming conventions MEAN. A **combo** match (`cc-*`, `is-*`)
  becomes a real combo class even with no `.base.combo` rule; a **utility** match (`u-*`,
  `text-*`) is always left as passthrough text — never a style block, never a combo — and wins
  over the combo list. Matched against the RAW class token, case-insensitively, so `sm:*` works.
  Empty means no opinion and behaves exactly as before. See `converter/class-patterns.js`.
- `nativeImages` (default `false`, wired to the "Native Images" toggle) — make **every** `<img>`
  a native Image: a `src` already on `cdn.prod.website-files.com` is kept and bound to its asset,
  anything else is replaced with Webflow's placeholder because it would 404 once published. Off,
  **every** `<img>` stays a Custom Element with its URL intact, whoever hosts it. See
  `converter/images.js`.
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
| `img` | Custom Element — or a native `Image` when `nativeImages` is on |
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

**`data-wf-displayName="Hero"` names the element in the Navigator.** It is an instruction to the
converter, not markup, so it is stripped from the published attributes — including out of a Code
Embed's own source. Works on every element type and on a per-tag Code Embed; it does NOT apply to
native form elements (they build their own nodes) or to the two merged embeds, which carry their
own fixed names. See `DISPLAY_NAME_ATTRIBUTE`.

The **first** class on an element becomes a real Webflow style block; every remaining class is
passed through verbatim as a custom `class` attribute so external frameworks (Tailwind) still
match. With utility patterns configured it is the first **non-utility** class instead —
`class="u-flex card"` is a card wearing a utility, not a "u-flex" component — and an element
whose classes are *all* utilities gets no style block at all.

An element with inline styles but **no class of its own** gets one generated, named after the
element: `<h2 style="color:red">` becomes `heading-2-980d0d40`, a `<p>` becomes
`paragraph-…`, a `<figcaption>` falls back to its own tag (`figcaption-…`). The words follow
Webflow's Navigator labels (`bold-text`, `text-span`, `block-quote`) so the class reads like the
thing it is sitting on. The suffix is a hash of the tag plus the CSS, which makes it
deterministic — re-pasting the same HTML reuses the class instead of piling up duplicates — and
means elements sharing both a tag and a set of inline styles share one block, while the same
declarations on a different tag get their own. See `GENERATED_CLASS_NAMES`.

**Combo classes** (`comb: "&"`, chained as `.base.combo`) come from two places:

- **A `.a.b` rule in a `<style>` block** becomes a real combo style block named `b`, and `b` is
  then removed from the element's passthrough `class` attribute so it is not applied twice.
  Pseudo-states and breakpoints work on it (`.card.featured:hover`, `@media … { .card.featured }`)
  through the same variant machinery as a base class.
- **Elements sharing a class but differing in inline styles.** The first one seen defines the
  base; a later one cannot append to that shared block without restyling every sibling, so it
  gets `.base.cc-variant-2` holding *only* the declarations that differ — numbering from 2,
  because the base element is variant 1. Identical variants share one combo.

- **A class name matching a combo pattern** the author configured (`cc-*`, `is-*`). No CSS rule
  needed — the block starts empty, ready to style in the Designer. See below.

Both live in `converter/style-registry.js`. A `.a.b` rule is only adopted when some element
actually carries both classes — otherwise it would be stripped from the embed and never
instantiated, losing the rule. Three-class chains (`.a.b.c`) and descendant selectors have no
equivalent this converter can build and stay in the embed.

**A rule is only adopted if the markup being converted uses its class**, for the same reason: a
`<style>` pasted on its own produces one Code Embed and no style blocks at all, because there is
nothing for a style block to attach to. Convert the CSS together with the HTML that uses it.

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
5. **`@raw` is not a universal escape hatch — *Custom properties* has an allowlist.** A property
   outside it is stored, renders and publishes, but the panel draws **no row for it at all**, so
   it cannot be seen or edited. Probing 41 declarations found exactly two the Designer swallows:
   the **`background`** and **`transition`** shorthands, both of which Webflow models as a list
   built from the longhands. Those stay in the Code Embed instead
   (`EMBED_ONLY_PROPERTIES`).
6. **Style blocks are matched by `_id`, not name.** Ids are derived deterministically from the
   class name (`idFromSeed`) so re-pasting the same HTML is idempotent.
7. **Whitespace between inline elements is significant.** Trimming text nodes glues words to
   neighbouring `<strong>`/`<em>`/`<a>`.
8. **A native Image's `src` is rewritten onto Webflow's CDN at PUBLISH**, keeping only the path,
   so an external URL renders perfectly on the canvas and 404s on the live site. There is no
   warning anywhere in the Designer. The rewrite belongs to the Image element *type* — a Custom
   Element publishes its `src` untouched — so only `cdn.prod.website-files.com` URLs are safe as
   native Images and everything else stays a Custom Element.
9. **An Image needs `data.img = { id: "" }` to keep its `src` on the canvas.** Empty is not the
   same as absent: omitting `data.img`, or giving a real asset id, both swap in the placeholder.
10. **Verifying on the canvas is not verifying.** Anything URL-shaped has to be published and
    loaded live — rule 8 passed every possible in-Designer check. And "it renders" is not the
    same as "the user can find it" — rule 5 renders perfectly and is unreachable in the UI.

---

## Known limitations / open items

### CSS variables cannot be mapped to Webflow variables

`var(--brand)` in source CSS stays a literal `var()` string. Webflow stores a variable
reference as a **binding to a variable id**, not as CSS text — and those ids live inside the
target site. A standalone converter cannot see them, so there is no way to produce a real
binding from HTML alone.

Current behaviour: a property whose value contains `var()` is wrapped in `@raw<|…|>`, so it
lands in *Custom properties* — visible, editable, and the CSS still resolves at runtime as long
as the variable is defined somewhere on the site (the `:root` block rides along in the Code
Embed). That is the correct outcome for a converter; the alternative (plain) would make it
invisible in the UI.

A `var()` in a **shorthand** is a separate trap: the CSSOM cannot expand it (*pending
substitution*) and hands back empty longhands, which would drop the declaration entirely. Those
are re-emitted as authored — see the CSSOM section of `docs/webflow-clipboard-format.md`.

Two of those shorthands, **`background`** and **`transition`**, have nowhere to land: *Custom
properties* draws no row for them (rule 5), so `@raw` would make them invisible. A **stylesheet**
rule keeps them in the Code Embed instead, split out of the rule while everything else in the
same block still goes native:

```css
.card { background: linear-gradient(160deg, var(--bg), #0d0d18); border-radius: var(--r); }
```
```
styleLess   border-radius: @raw<|var(--r)|>;
embed       .card { background: linear-gradient(160deg, var(--bg), #0d0d18); }
```

The embed's `<style>` sits in the body, after Webflow's own stylesheet in `<head>`, so at equal
specificity the author's declaration is the one that applies. A rule inside an adopted `@media`
is re-wrapped in that same query, so it still only applies at its breakpoint.

**A rule is only split when splitting cannot change what it means.** That position in the
cascade is exactly what makes `background` dangerous to move on its own:

```css
.gradient-text { background: linear-gradient(…, var(--v), …); background-clip: text; }
```

Lifting `background-clip: text` into the Style panel and leaving `background` in the embed puts
the shorthand *after* it — where it resets `background-clip` back to `border-box` and silently
kills the effect. So when a deferred shorthand shares its property family with anything else in
the same rule (including a vendor-prefixed sibling like `-webkit-background-clip`), the whole
rule stays in the embed and the class gets an empty style block. Correct CSS beats a
half-populated Style panel. See `isEntangled` in `inline-css.js`.

**An inline `style="…"` cannot take that path** — it has no selector, so there is no rule to
leave the declaration in, and it stays in `styleLess`: rendering and publishing correctly, but
with no row in the Designer. Rare in practice (it needs a `var()` *inside a shorthand*, in an
inline attribute), and dropping the style would be worse.

Bridging this would require reading `CssVariablesStore` from inside the Designer (a browser
extension or Designer Extension), which is a different product shape.

### Components cannot be produced by this app

Copying a Webflow Component gives you its **flattened contents** — no name, no group, no symbol
id. The only trace is `meta.unlinkedSymbolCount: 1`, and pasting it back makes plain elements.
Webflow raises a toast saying so: *"For pasting cross-site we had to unlink components."*

So there is nothing to reverse-engineer; the unlinking is deliberate and happens at copy time.
The converter's job ends at emitting the component's contents — turning those into a Component
is a Designer action (**Create Component**) or a job for Webflow's component API. Full detail:
`docs/webflow-clipboard-format.md`.

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
- **`repeat()` is expanded into explicit grid tracks.** Webflow's Grid control cannot read it:
  `repeat(3, 1fr)` renders three columns on the canvas while the panel reports **1 column, 0
  rows**, and touching the stepper then overwrites the author's value with that wrong count.
  `repeat(3, 1fr)` IS `1fr 1fr 1fr`, so expanding it is lossless and gives a fully working
  panel. The `auto-fill` / `auto-fit` form has no fixed track list and cannot be expanded, so it
  goes to *Custom properties* instead — visible and editable, with the Grid stepper greyed out
  rather than misreporting. Over `MAX_REPEAT_EXPANSION` tracks it also falls back.
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
