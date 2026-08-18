# Webflow clipboard format (`@webflow/XscpData`) — reverse-engineered reference

Everything here was established by probing a **live Webflow Designer**, not from documentation.
Webflow can change any of it without notice. Treat it as a strong prior that still needs a
guard, never as a contract.

**Why this file exists:** the mistakes in this area do not throw. A wrong `v` crashes the whole
Designer. A wrong `class` key publishes as nothing. A missing `@raw<|…|>` makes a value
invisible in the Style panel while still rendering. Someone working here without this reference
will produce something that *appears* to work.

---

## 1. Envelope

```jsonc
{
  "type": "@webflow/XscpData",
  "payload": {
    "nodes":  [ /* flat list, parents before children */ ],
    "styles": [ /* style blocks */ ],
    "assets": [], "ix1": [],
    "ix2": { "interactions": [], "events": [], "actionLists": [] }
  },
  "meta": {
    "droppedLinks": 0, "dynBindRemovedCount": 0, "dynListBindRemovedCount": 0,
    "paginationRemovedCount": 0, "universalBindingsRemovedCount": 0,
    "unlinkedSymbolCount": 0, "codeComponentsRemovedCount": 0,
    "richTextComponentsStripped": false
  }
}
```

The clipboard flavour must be **`application/json`**. The async Clipboard API refuses that MIME
type, so the only way to produce it is to hijack a real `copy` event inside a user gesture —
see `assets/js/ui/clipboard.js`.

### THE SINGLE-ROOT RULE (crashes the Designer)

A "root" is any node no other node lists in its `children`. **More than one root crashes the
entire Designer**, with this in the console:

```
Error: Subtree reification resulted in more than one root!
    at reifyElementSubtree
    at Tree.getElementWithJSONNodes
    at getEventualCrossSitePasteDetails
```

External payloads take Webflow's *cross-site paste* path, which reifies everything into one
subtree. Reproduced with two plain `Block` nodes — nothing to do with embeds or forms. The
converter wraps multiple roots in a `Block`.

### Components cannot be created from a payload

**The clipboard format has no component representation, so a converter cannot emit one.**

Copying a Webflow Component produces its **flattened contents** and nothing else — no name, no
group, no symbol id, no reference of any kind. The only trace is a counter in `meta`:

```jsonc
"meta": { …, "unlinkedSymbolCount": 1, … }   // "a component was stripped on the way out"
```

Pasting that payload back makes plain elements. Webflow says so itself, in a toast raised on
paste:

> **Paste** — For pasting cross-site we had to unlink components.

Verified by pasting the clipboard data of an "Example Card" component into a site where that
very component exists: the result was a `Div Block`, not an instance, and the toast appeared.
So it is not a matter of finding the right fields — the unlinking is deliberate and happens at
copy time.

The two real routes to a component both live outside the clipboard: select the pasted elements
in the Designer and use **Create Component**, or drive Webflow's component API (the Webflow MCP
exposes component tools). Same shape of limitation as CSS variables in §4 — the identity lives
inside the target site, and a standalone converter cannot see it.

### A text node cannot be the root either

`{ "_id": "…", "text": true, "v": "hello" }` is a **child-only** shape — it has no `type` and no
`tag`, so it is not an element. It does not crash, but Webflow has to invent a container for it
and produces a **Div Block with a Text field** rather than anything you asked for.

The same applies one level down. A text node can only sit directly inside an element that is
itself a text flow (`data.text: true`); once a parent has a block-level child it is a container,
and its loose text has nowhere legal to go. `<div>a<div>x</div></div>` therefore becomes:

```
Block                      (container, text:false)
  Block  text:true  "a"    <- the loose text, given its own text-type Div Block
  Block  text:true  "x"
```

The converter wraps top-level text in a `Paragraph` and nested loose text in a text-type
`Block`, so in both cases the container is one it chose rather than one Webflow guessed.

A crash leaves a "Something went wrong" dialog with a **Send** button (reports to Webflow —
click Cancel). The crash reload also **severs the undo chain**, so anything pasted before it
must be deleted by hand.

---

## 2. Node shapes

Common `data` keys on native elements:

```jsonc
"data": {
  "text": false,
  "tag": "div",                      // only on Block/Section/Heading/List/Blockquote
  "devlink": { "runtimeProps": {}, "slot": "" },
  "displayName": "",
  "attr": { "id": "" },              // the element's own id
  "xattr": [ {"name": "...", "value": "..."} ],   // custom attributes
  "search": { "exclude": false },
  "visibility": { "conditions": [], "keepInHtml": { "tag": "False", "val": {} } }
}
```

### `data.text` marks "my content IS text"

```jsonc
{ "type": "Block", "tag": "div", "children": ["<a text node>"],
  "data": { "text": true, "tag": "div", … } }
```

`true` when the element's content is a TEXT FLOW. On a `Block` the effect is visible: the
Navigator stops calling it "Div Block" and labels it with its own text, and the Settings panel
grows a **Text** field.

**Inline children do not break it.** Webflow's payload for a div reading *"This is some text
inside of a div block."* carries `text: true` while holding `<code>`, `<em>`, `<sup>`,
`<strong>`, `<span>` and `<a>` children. Only a **block-level** child makes it a container again.
Getting this backwards — assuming any element child disqualifies it — is an easy mistake, since
the text-only case looks like sufficient evidence on its own.

Webflow's own payloads are not uniform about the key — a `Paragraph` holding text has **no
`text` key at all**, because a paragraph is inherently a text element. The converter writes
`true` on every type whose content is a text flow, a deliberate simplification verified by paste.

### Inline formatting types

| tag | type |
| --- | --- |
| `code` | `InlineCode` |
| `sup` | `Superscript` |
| `sub` | `Subscript` |
| `span` | `Span` — takes `classes`, which is how a styled text span works |
| `strong`/`b` | `Strong` |
| `em`/`i` | `Emphasized` |

Without these a `<code>` or `<span>` becomes an opaque Custom Element sitting inside otherwise
editable text. All six verified by paste, `sub` included (that one was inferred from
`Superscript` and then confirmed, not read off a payload).

Webflow serializes these inline children **with no `data` key at all**. This converter emits its
usual full `data`; extra keys are dropped on paste and all six render correctly, so the shapes
are not required to match.

`<br>` is its own type and the one case where `data` really is different — it carries a `sym`
marker and **none** of the usual keys (no devlink, attr, xattr, search, visibility):

```jsonc
{ "type": "LineBreak", "tag": "br", "classes": [], "children": [],
  "data": { "sym": { "inst": "LineBreak" } } }
```

A LineBreak counts as inline, so `<div>a<br>b</div>` stays one text flow rather than splitting
into separate text blocks.

### A Link inside a text flow uses `block: ""`

A standalone Link takes `data.block: "inline"`, which publishes with the `w-inline-block` class.
Inside a text flow that is wrong — Webflow writes `block: ""` there, giving a plain
`display: inline` link. The difference is real: an inline-block link will not wrap mid-phrase and
sits on a different baseline.

### Combo classes: `comb: "&"` plus a parent link

A combo class is one that only applies chained onto another, as `.base.cc-variant-2`. Two fields
make it, and BOTH are needed:

```jsonc
// the base
{ "_id": "52fe…", "name": "new-test-card", "comb": "",
  "children": ["3e62…"],                    // <- names its combos
  "styleLess": "…the shared declarations…" }

// the combo
{ "_id": "3e62…", "name": "cc-variant-2", "comb": "&",
  "children": [],
  "styleLess": "border-top-color: red; …" } // <- ONLY what differs
```

The element then lists both ids in `classes`, base first. The combo carries only the differing
declarations — everything shared keeps coming from the base, which is the whole point.

**A combo can add but never unset.** A property the base sets and the variant does not will keep
applying; there is no way to express its absence through a chained class.

**The same combo NAME under two different bases is two different style blocks.** Verified by
pasting `.dualbase-alpha.cc-variant-2` (color) and `.dualbase-beta.cc-variant-2` (opacity)
together: each applied only to its own base, with no bleed. So the ids must be distinct — this
converter seeds them from `combo:<base>:<name>` rather than the name alone.

**A Custom Element gets its combo too.** `type: "DOM"` publishes the `class` *attribute* only
from `data.attributes` (see below), but the `classes` array of style ids is honoured for every
type — verified with a `<figcaption class="domchk hi">`, which picked up the combo's
`font-weight`. So a class consumed into a combo must NOT also be left in `data.attributes`, or
it is applied twice.

### `class` lives in two different places

| Element | `class` publishes from |
| --- | --- |
| Custom Element (`type: "DOM"`) | `data.attributes` — a class in `xattr` is **silently dropped** |
| every other type | `data.xattr` |

Non-`class` attributes (`data-*`, `aria-*`) publish from `xattr` on every type. Attributes the
node already represents natively must NOT be duplicated into `xattr`: `class`, `style`, `id`,
and `href` on a Link (it lives in `data.link.url`).

### Custom Element

```jsonc
{ "type": "DOM", "tag": "div",
  "data": { "tag": "svg", "attributes": [{"name":"width","value":"24"}],
            "text": false, "slot": "", "visibility": {...} } }
```

Node-level `tag` is always `"div"`; the real tag is `data.tag`. Has none of the
devlink/attr/search keys.

### Block semantic tags

A `Block` accepts a semantic tag via `data.tag`. Webflow's Tag dropdown offers exactly:

```
div, header, footer, nav, main, section, article, aside, address, figure
```

`<nav>` becomes `type: "Block"`, node `tag: "nav"`, `data.tag: "nav"` — it shows in the
Navigator as **Navigation** with a working Tag dropdown. Anything outside that list must fall
through to a Custom Element.

### Code Embed — `v` is a landmine

```jsonc
{ "type": "HtmlEmbed", "tag": "div", "v": "<style></style>",
  "data": { "search": { "exclude": true },
            "embed": { "type": "html",
                       "meta": { "html": "", "div": false, "script": false,
                                 "compilable": false, "iframe": false } },
            "insideRTE": false,
            "content": "<style>\n  .x { color: red }\n</style>",
            "xattr": [], "devlink": {...}, "displayName": "",
            "attr": { "id": "" }, "visibility": {...} } }
```

| `v` | Result on paste |
| --- | --- |
| the full source | **Designer hard-crashes** |
| `""` | **silent no-op** — nothing is created, no error |
| the tag skeleton `<style></style>` | works; `data.content` carries the real source |

Generate `v` with a shallow clone — `node.cloneNode(false).outerHTML` — which keeps the tag and
its attributes (`<style media="print"></style>`) and drops the body.

A bare `<style></style>` / `<script></script>` is a valid `v` even when `data.content` holds
several tags — verified by pasting one embed carrying a `<script src>` plus an inline `<script>`.
`data.embed.meta.script` must still be `true` for anything containing a script, or Webflow
renders it as an HTML embed instead of showing the "only displays in preview mode" notice.

### Navigator labels live in a NODE-level `meta`

```jsonc
{ "_id": "…", "type": "HtmlEmbed", "meta": { "displayName": "CSS Code Embed" },
  "data": { "displayName": "", … } }
```

`meta.displayName` is a **sibling of `data`**, not a key inside it — `data.displayName` stays
`""`. Verified live on a Code Embed ("CSS Code Embed" where every other embed shows the generic
"Code Embed") and again on ordinary elements: a `Block`, a `Heading` and a Custom Element pasted
with the key each showed their given name in the Navigator, while a sibling without it fell back
to Webflow's default label. So it is not embed-specific — it works for any node type.

The converter exposes this as the `data-wf-displayName` authoring attribute, which it strips
before publishing (see `DISPLAY_NAME_ATTRIBUTE`).

### Image — THE CANVAS LIES ABOUT `src`

**Read this before touching image conversion.** A native Image renders any external URL
perfectly on the canvas, survives a Designer reload, and passes every check you can run from
inside the Designer. It still ships a **broken image**, because on **publish** Webflow rewrites
the src onto its own CDN, keeping only the path:

| authored src | published src |
| --- | --- |
| `https://picsum.photos/seed/x/100/200` | `https://cdn.prod.website-files.com/seed/x/100/200` — 404 |
| `https://cdn.prod.website-files.com/<site>/<asset>_photo.jpg` | unchanged — the rewrite is a no-op |
| `https://d3e54v103j8qbb.cloudfront.net/plugins/Basic/assets/placeholder.60f9b1840c.svg` | `https://cdn.prod.website-files.com/plugins/…placeholder…svg` — **AccessDenied** |

That last row is Webflow's own placeholder asset doing this to itself, so it is not something
the converter causes or can avoid.

This is the single worst failure mode in this file: there is **no signal inside the Designer**.
Verifying on the canvas is not verifying. **Publish and view the live page.**

**The rewrite belongs to the Image element type, not to image URLs in general.** A Custom
Element (`type: "DOM"`, `data.tag: "img"`) publishes its `src` untouched — Webflow has no Image
semantics to apply to it.

Hence `converter/images.js` treats the `nativeImages` option as the whole decision. **Off** — the
default — every `<img>` is a Custom Element and keeps its URL, whoever hosts it. **On**, a src
already on `https://cdn.prod.website-files.com/` is kept (the rewrite is a no-op on its own CDN)
and everything else becomes the placeholder, because it would 404 live.

Being on Webflow's CDN is not on its own a reason to force a native Image: a Custom Element
renders that src perfectly well, and one switch that predicts the whole output beats a rule that
silently changes element type based on the URL.

Both element types confirmed on one published page. Of nine images, **exactly two loaded**:

| element | src | published |
| --- | --- | --- |
| native Image | `cdn.prod.website-files.com/<site>/<asset>_photo.jpg` | **loads** |
| Custom Element | `picsum.photos/seed/domtest/100/200` | **loads, URL untouched** |
| native Image | any other origin | rewritten → broken |

Those two rows are exactly what the converter emits.

### Image — `data.img.id` must be present and EMPTY

```jsonc
{ "type": "Image", "tag": "img", "classes": [], "children": [],
  "data": { "attr": { "src": "https://example.com/photo.jpg", "alt": "…",
                      "width": "100", "height": "200", "loading": "eager", "id": "" },
            "img": { "id": "" },          // <- the whole trick
            "srcsetDisabled": false, "sizes": [],
            "devlink": {…}, "displayName": "", "xattr": [],
            "search": { "exclude": false }, "visibility": {…} } }
```

Separate from the publish problem above. `data.img` must be **present**; its `id` decides whether
the Image is bound to a real asset or just showing a URL:

| `data.img` | result |
| --- | --- |
| key absent entirely | src **replaced** with Webflow's placeholder |
| `{ "id": "" }` | `data.attr.src` used verbatim, **no srcset** |
| `{ "id": "<id that does not resolve>" }` | same as empty — **degrades gracefully** |
| `{ "id": "<a real asset on this site>" }` | **bound**: Webflow generates a full responsive srcset |

Empty is not the same as absent, and the difference is invisible until you try all four.

### Recovering the asset id from a URL

A Webflow asset URL carries the id in its own filename:

```
https://cdn.prod.website-files.com/664a0a1f64f88585601810d7/6706a0e49f52912584691a21_preview-1.avif
                                   └──── siteId ─────────┘ └──── assetId ────────┘└ origName ┘
```

So `data.img.id` is derivable from the src alone — see `WEBFLOW_ASSET_ID_IN_URL`. Verified **on a
published page**, not just the canvas: a derived id produced a **7-entry srcset plus a `sizes`
attribute**, from an **empty `assets[]`** in the payload. Webflow's
own copy ships a huge asset descriptor (fileHash, dimensions, every variant, S3 urls); that is
Webflow exporting what it already has, **not** an input requirement, which matters because a
converter could never synthesize it from an HTML string.

This is safe to do unconditionally: an id that does not resolve on the target site falls back to
`data.attr.src` — the unbound behaviour — and a derived id can never point at the *wrong* file,
because it came out of that file's own URL.

### Webflow's own defaults for an unset Image

```jsonc
"attr": { "src": "<placeholder>", "loading": "lazy", "width": "auto", "height": "auto",
          "alt": "__wf_reserved_inherit", "id": "" },
"img": { "id": "plugins/Basic/assets/placeholder.svg" }
```

`width`/`height` are the literal string `"auto"`, `loading` defaults to `"lazy"`, and `alt` takes
one of two reserved sentinels:

| value | meaning |
| --- | --- |
| `__wf_reserved_inherit` | inherit the alt text stored on the asset |
| `__wf_reserved_decorative` | decorative — publishes as `alt=""` |

`alt=""` in source HTML means exactly "decorative", so it maps onto the second one — and so does
a **missing** `alt`, since omitting the key leaves the Alt Text field blank, which helps a screen
reader no more than decorative does and hides the decision from the Designer. Only real alt text
survives as itself.

The converter emits `loading: "lazy"` when the source says nothing, matching Webflow: leaving the
key off means "Auto: defaults to browser", and browsers only lazy-load when explicitly told to.

`src`/`alt`/`width`/`height`/`loading` live in **`data.attr`**, not `xattr` — that is where the
Settings panel reads them. Only `src` is required; the others can be omitted and the panel falls
back to its own defaults. There is no `data.text` key on an Image.

With no asset there is no `srcset`, so Webflow serves no responsive variants, and the Settings
panel's image chip shows the placeholder's metadata beside a correctly rendering picture.

### Native form elements (`nativeForms`)

```
FormWrapper            data.form={type:"wrapper"}, search.exclude=TRUE
  FormForm             data.Source={tag:"Default form",val:{}}, data.form={type:"form",name}
                       attr: id/name = "wf-form-<Name>", data-name, redirect, data-redirect,
                             action, method
    FormBlockLabel     attr.for, form={type:"label",passwordPage:false}
    FormTextInput      form={name,type:"input",passwordPage:false}
                       attr: id,name,maxlength:256,data-name,placeholder,disabled,type,
                             required,autofocus
    FormTextarea       maxlength:5000
    FormCheckboxWrapper  form={type:"checkbox"}
      FormCheckboxInput  form={type:"checkbox-input",name}, inputType:"default"|"custom",
                         attr.checked
      FormInlineLabel    form={type:"checkbox-label"}
    FormRadioWrapper / FormRadioInput (attr.value) / FormInlineLabel (radio-label)
    FormSelect         form={name,opts:[{t,v}],type:"select"}, attr.multiple
    FormButton         tag "input", attr {type:"submit", value, data-wait}
  FormSuccessMessage   form={type:"msg-done"}  -> Block(text:true) -> text
  FormErrorMessage     form={type:"msg-fail"}  -> Block(text:true) -> text
```

A **standalone** field (no `<form>`) is valid — Webflow puts a lone `FormTextInput` on the
clipboard itself. Do not synthesize a wrapper for one.

---

## 3. Style blocks

```jsonc
{ "_id": "…", "fake": false, "type": "class", "name": "main-class",
  "namespace": "", "comb": "",
  "styleLess": "color: #f5f54d; translate: @raw<|0 0|>;",
  "variants": { "main_hover": { "styleLess": "color: #7f6ee9;" } },
  "children": [], "createdBy": "…", "origin": null, "selector": null }
```

### Matched by `_id`, not name

A fresh random id with an existing name makes Webflow **rename** the incoming class
("Renamed 4 classes in order to avoid conflicts" → `hero-section 2`, `hero-section 3`, …).
Deriving the id deterministically from the class name makes repeat pastes idempotent. It cannot
merge with classes the site already created by hand — those carry Webflow's own ids, which are
unknowable from outside.

### Variants: breakpoints and pseudo-states

`styleLess` itself holds the base (`main`, desktop) breakpoint's styles. Everything else lives
in `variants`, keyed by the bare breakpoint name for that breakpoint's base styles and
`<breakpoint>_<state>` for pseudo-states. Both verified from a reference payload copied out of
a live Designer (an element styled at every breakpoint and state) and by pasting a converter
payload back in — the Style panel picked every variant up on its breakpoint.

| variant key | media query in Webflow's published CSS |
| --- | --- |
| `medium` | `(max-width: 991px)` |
| `small` | `(max-width: 767px)` |
| `tiny` | `(max-width: 479px)` |
| `large` | `(min-width: 1280px)` |
| `xl` | `(min-width: 1440px)` |
| `xxl` | `(min-width: 1920px)` |

max-width variants cascade DOWN from `main`, min-width variants cascade UP — the same
semantics the equivalent media queries have, which is why the converter can lift an
exactly-matching `@media` rule into a variant without changing behaviour. A query that does
not exactly match one of those six conditions (modulo a `screen and` / `only screen and`
prefix) has no variant equivalent and must stay in a Code Embed.

Pseudo-state suffixes:

```
hover   active   focus   focus-visible        e.g. main_hover, medium_hover, xxl_focus
```

Verified that Webflow emits real CSS for each (`.cls:hover`, `.cls.-wfp-hover`, …). Only those
four states have a Style-panel equivalent; anything else belongs in a Code Embed.

### `styleLess` is stored VERBATIM

Webflow does **not** re-parse or re-serialize `styleLess` on paste — a copy round-trip returns
exactly the string you supplied. Consequences:

- you cannot get Webflow to normalize your CSS for you;
- you cannot mine the format by round-tripping;
- whatever you write is what the Style panel reads.

### `@raw<|value|>` — the Custom-properties wrapper

| declaration | CSS renders | Style panel |
| --- | --- | --- |
| plain + property has a panel control | yes | its own control (Typography, Spacing…) |
| plain + property has **no** control | yes | **invisible** — no UI at all |
| `@raw<|…|>` + any property | yes | *Custom properties* section |

So the wrapper is required in **two** cases, and it is a per-**declaration** decision, not
per-property:

1. the property has no panel control (`translate`, `padding-inline`)
2. the property has one but the **value** doesn't fit it —
   `padding-left: calc(2 * 1rem)`, `color: color-mix(…)`, `…: var(--x)`

Wrapping indiscriminately is wrong: a wrapped `color` or `padding-top` gets dragged out of its
real control into Custom properties.

The allowlist lives in `PANEL_STYLE_PROPERTIES` (`config/constants.js`), seeded from a reference
element with every UI-settable style applied. **It is deliberately conservative** because the
failure modes are asymmetric: omitting a property just moves it to Custom properties (visible,
editable, correct CSS), whereas wrongly including one makes it vanish from the UI.

### Custom properties has its OWN allowlist — `@raw` is not universal

The third row of that table is not quite true. *Custom properties* will not render a row for
just any property: the section has an allowlist of its own, and a property outside it is stored
in `styleLess` and renders on the canvas while the panel shows **nothing at all** — the exact
failure `@raw` exists to prevent.

Measured by pasting probe elements carrying 41 declarations and reading back what the panel did
with each:

| landed | how |
| --- | --- |
| `border`, `border-radius`, `animation`, `font`, `flex`, `gap`, `inset`, `list-style`, `text-decoration`, `outline`, `columns`, `margin`, `padding`, `place-items`, `grid-area`, `mask`, `border-image`, `flex-flow`, `overflow`, `grid-template`, `border-width`, `border-color`, `border-style`, `transform`, `filter`, `backdrop-filter`, `box-shadow`, `text-shadow`, `grid-template-columns`, `grid-template-rows`, `background-color` | a *Custom properties* row |
| `background-image`, `background-size`, `background-position`, `background-repeat`, `background-attachment` | adopted into the **Backgrounds** section |
| `transition-property` / `-duration` / `-timing-function` / `-delay` | collapsed into one `transition` row |
| **`background`**, **`transition`** | **nowhere — invisible** |

The two that vanish are the shorthands Webflow models as a **list built from the longhands**
(background layers; the transition list), so the shorthand itself has no slot. It matches what
the Designer's own autocomplete offers: typing `background` suggests `background-color`,
`background-clip`, `background-blend-mode`… but never `background`.

They live in `EMBED_ONLY_PROPERTIES`, and the converter leaves them in the Code Embed as CSS
(see `collectStylesheets` — the selector is still all-or-nothing, but the declarations are not).
Only reachable via the pending-substitution passthrough below: without a `var()` the CSSOM
expands both into longhands, which are fine.

Reading the panel back is awkward — its rows live in a shadow root, so `querySelectorAll` from
the page finds nothing. Screenshot the panel, or diff against `styleLess`:

```js
_webflow.getStoreState('StyleBlockStore').styleBlocks.toArray()
  .find(b => b.get('name') === 'my-class').get('styleLess')
```

### The Grid control cannot read `repeat()`

A control existing for a property is not the same as it understanding every legal value. Pasted
into a live Designer and read back off the Layout panel:

| `grid-template-columns` | canvas | Grid panel |
| --- | --- | --- |
| `repeat(3, 1fr)` | 3 columns | **1 column, 0 rows** |
| `1fr 1fr 1fr` | 3 columns | 3 columns |
| `repeat(auto-fill, minmax(200px, 1fr))` | 4 columns | **1 column, 0 rows** |

The misreport is worse than cosmetic: the panel writes back what it thinks it read, so nudging
the stepper replaces the author's `repeat()` with a single column. Webflow's own grids are
always serialized as explicit tracks (`1fr minmax(0px, 1fr)`) — it never emits `repeat()`.

So `formatDeclaration` expands a countable `repeat(N, <tracks>)` in place before deciding where
the declaration goes. That is a pure rewrite — `repeat(3, 1fr)` and `1fr 1fr 1fr` are the same
computed value — and it applies only to `GRID_TRACK_PROPERTIES`, so a `content: "repeat("`
string is untouched. What cannot be expanded (`auto-fill`, `auto-fit`, or more tracks than
`MAX_REPEAT_EXPANSION`) still contains `repeat(`, which `UNREPRESENTABLE_VALUE` now matches, so
it routes to *Custom properties*: the value stays visible and editable and the Grid stepper is
greyed out instead of claiming a value it is misreading. Verified live — the auto-fill grid
still computes `236px 236px 236px 236px` on the canvas from its Custom properties row.
### CSSOM normalization traps

Two separate problems, both caused by leaning on the browser's CSS parser.

**Never re-emit CSS with `rule.cssText`.** The CSSOM's serialization is not the source text — it
expands some shorthands and collapses others, unpredictably:

| Source | `rule.cssText` gives back |
| --- | --- |
| `border-top: none` | `border-top-width: medium; border-top-style: none; border-top-color: currentcolor` |
| `transition: all .3s ease` | `transition: .3s` |
| `background: none` | `background: none` (round-trips — which is what makes this trap easy to miss) |

That is fine for the Style panel, which wants longhands, but wrong for the CSS the converter
hands back to a Code Embed: the user still has to read and maintain it. So `stylesheet.js`
slices leftover rules out of the **original source** with its own top-level splitter and uses
the CSSOM only to *classify* them. The splitter has to skip comments and strings before
counting braces — `content: "}"` is legal CSS.

**A shorthand containing `var()` cannot be expanded at all.** This is the worst of the three,
because it loses the declaration outright rather than mangling it:

```js
el.style.cssText = "background: linear-gradient(160deg, var(--bg), #0d0d18)";
el.style.length                                 // 9  - every background longhand is listed
el.style.getPropertyValue("background-image")   // ""  <- ALL of them are empty
el.style.getPropertyValue("background")         // the original value, intact
```

CSS calls this **pending substitution**: a shorthand whose value contains `var()` cannot be
split into longhands until the variable is resolved, so the CSSOM lists the longhands and
serializes each as `""`. Expanding it emits `background-image: ; background-color: ;` … and the
element silently loses its background. `border: 1px solid var(--x)` and
`border-radius: var(--r)` fail the same way.

A **longhand** holding `var()` is fine (`color: var(--text)` round-trips), which is how to tell
the two apart: the pending-substitution shorthand is the one that does NOT appear in the
`el.style` listing. `expandDeclarations` re-emits those as authored.

**…and `rule.style.cssText` may not contain the shorthand at all.** The two traps above compose
into a third that deletes CSS outright. A shorthand whose longhands are *later overridden* in
the same block cannot be reconstructed, so the CSSOM serializes the longhands individually
instead — and under pending substitution those are all empty:

```js
sheet.replaceSync(`.gradient-text {
  background: linear-gradient(100deg, var(--violet), var(--blue));
  background-clip: text;          /* <- overrides one of background's longhands */
}`);
sheet.cssRules[0].style.cssText
// "background-image: ; background-position-x: ; … background-clip: text"
sheet.cssRules[0].style.getPropertyValue("background")   // ""  <- the gradient is GONE
```

Note the difference from the plain pending-substitution case: there, `getPropertyValue`
("background") still hands the value back. Here it does not, so there is **nothing** to recover
from the CSSOM. `tryAdoptStyleRule` therefore feeds the expander the rule's ORIGINAL sliced text
(`openBlock(sourceText).body`), never `rule.style.cssText`.

**A deferred shorthand cannot always be moved on its own.** The Code Embed's `<style>` is in the
body, so anything left there lands *after* Webflow's stylesheet in the cascade. Split the rule
above and `background` would re-run after the adopted `background-clip: text`, resetting it to
`border-box` — the CSS is all still present and the effect is dead. When the deferred shorthand
shares a property family with anything else in the rule — `background-clip`, or a prefixed
`-webkit-background-clip`, which the CSSOM folds into the unprefixed name and would otherwise
drop — the whole rule stays in the embed (`isEntangled`). Verified live: the pasted element
computes `background-image: linear-gradient(100deg, rgb(124,92,255), …)`,
`-webkit-background-clip: text`, `color: rgba(0,0,0,0)`.

Two rules follow, and both matter on their own:

- **Never emit an empty value.** `prop: ;` is not a faithful declaration, it is a broken one.
- **One authored shorthand should not become eleven entries.** `animation: float-y 7s ease-in-out
  infinite` expands to eleven longhands including `animation-timeline` and `animation-range-end`,
  none of which Webflow has a control for, so they all land in Custom properties. It round-trips
  losslessly, so it is emitted whole. `transition` deliberately does **not** get this treatment:
  its round trip *drops the timing function* (`transform .25s ease` → `transform 0.25s`), and its
  longhands are panel-backed anyway.

**Property-level disagreements** with Webflow that silently push values into Custom properties.
Handled via `PREFERRED_SHORTHANDS` and `PROPERTY_ALIASES`:

| Source | Browser gives | Webflow writes |
| --- | --- | --- |
| `overflow: hidden` | `overflow-x` + `overflow-y` | `overflow` |
| `white-space: nowrap` | `white-space-collapse` + `text-wrap-mode` | `white-space` |
| `text-decoration: underline` | `text-decoration-line` | `text-decoration` (line keyword only) |
| `gap: 8px` | `row-gap` / `column-gap` | `grid-row-gap` / `grid-column-gap` |

`text-decoration` is subtle: Webflow's "Line" dropdown holds **only** the line keyword. Handing
it the compound shorthand the CSSOM builds (`underline 5px dotted rgb(…)`) leaves that dropdown
**blank**, while the sibling `-style`/`-color`/`-thickness` declarations still populate.

Other normalizations are cosmetic and semantically identical — `linear-gradient(180deg, …)` →
`linear-gradient(…)`, `cubic-bezier(.755…)` → `cubic-bezier(0.755…)`, `calc(2 * 1rem)` →
`calc(2rem)`, text-shadow colour reordered.

### Class-name normalization

Webflow lowercases, collapses runs of invalid chars to one hyphen, trims surrounding `-`/`_`,
and prefixes a leading digit with `_`. **Non-ASCII is dropped, not transliterated**
(`café` → `caf`). A name that normalizes to `""` cannot exist as a class. See
`converter/class-names.js` — do not "fix" it into a transliterating slugifier.

---

## 4. CSS variables — the unbridgeable gap

**`var(--x)` cannot be mapped onto a real Webflow variable from a standalone tool.**

Webflow stores a variable reference as a **binding to a variable id** that lives inside the
target site (`CssVariablesStore`), not as CSS text. A converter that only sees an HTML string
has no access to those ids, and there is no way to derive them from a variable *name* — the
same `--brand` in two sites is two different ids.

**Current behaviour (correct for a converter):** a panel-backed property whose value contains
`var()` matches `UNREPRESENTABLE_VALUE` and is wrapped in `@raw<|…|>`, so it lands in *Custom
properties*. It stays visible and editable, and the CSS still resolves at runtime provided the
variable is defined somewhere on the site. Emitting it plain would make it invisible in the
Style panel — the worse failure.

What it would take to bridge it: run inside the Designer (browser extension or Designer
Extension), read `CssVariablesStore` to map variable *names* to ids, then emit the binding shape
instead of a CSS string. That is a different product shape, not a change to this app.

The same is true of `img` assets, for a different reason: an Image accepts an empty asset id and
will show any URL on the canvas, but publish rewrites that URL onto Webflow's CDN — so an
external image cannot be a native Image either. See §2.

---

## 5. Testing against a live Designer

Synthetic events do not work. `ClipboardEvent('paste')` is rejected
(`Cannot read properties of null (reading 'activeElement')`), and the async Clipboard API
refuses `application/json`. You need a **real copy + real Ctrl+V**.

### Traps that produce false results

1. **`execCommand('copy')` is blocked on a hidden tab** and returns `false` silently. Take a
   screenshot of the converter tab first — that foregrounds it. Verify the button flipped to
   "Copied JSON" before trusting it.
2. **Switching browser tabs clears the Designer's selection.** Re-select after coming back.
3. **The first click on the canvas after a page load only focuses it** — click twice.
4. **A paste with no valid selection is a silent no-op.** Never infer success from the absence
   of a crash; assert on the canvas DOM or a node count.
5. **`NavigatorStore` never self-heals after a write.** It stays stale indefinitely. Click any
   element to force a `NODE_CLICKED` rebuild before reading.
6. **Once the Designer crashes, that tab stays unstable** and may crash on later pastes
   regardless of payload. Full page reload before continuing.
7. **Asset-derived state arrives asynchronously.** An Image bound to a real asset has **no**
   `srcset` for the first moment after paste — Webflow resolves the asset from the server and
   fills it in afterwards. Reading immediately reports 0 variants and looks like a failed bind.
   Re-read before concluding anything.
8. **The canvas is not the published site.** Anything involving a URL — image `src` above all —
   must be checked by **publishing and loading the live page**, because Webflow rewrites some of
   them on the way out and the Designer gives no hint. A canvas screenshot, a `naturalWidth`
   assertion and a Designer reload all passed for an external image `src` that ships 404.

### Injecting an arbitrary payload (no tab switching)

```js
window.__payload = JSON.stringify(payload);
window.__inj = (e) => {
  e.clipboardData.setData('application/json', window.__payload);
  e.clipboardData.setData('text/plain', window.__payload);
  e.preventDefault();
};
window.addEventListener('copy', window.__inj, false);   // bubble phase = after Webflow's
// then: select an element, Ctrl+C (your payload overrides), Ctrl+V
```

**Remove this listener when done** — it hijacks every copy in the user's Designer.

### Capturing what Webflow itself produces

Listen for `copy` in the **bubble** phase (`window` or `document`, not capture) — in capture
phase `clipboardData` is still empty because Webflow hasn't written it yet.

### Useful reads

```js
_webflow.getStoreState('StyleBlockStore').styleBlocks.toArray()   // ImmutableJS, use .get()
_webflow.getStoreState('NavigatorStore').root.nodes[0][0].element
document.getElementById('site-iframe-next').contentDocument       // the canvas
```

Mining Webflow's own serialization from an existing site is the most reliable way to learn the
format — scan every style block's `styleLess` for `@raw<|` to see which properties it wraps.
