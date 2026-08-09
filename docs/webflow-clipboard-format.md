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
`""` and setting it alone does nothing. Verified live: an embed pasted with the `meta` key shows
as "CSS Code Embed" in the Navigator, where every other embed shows the generic "Code Embed".

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

The same reasoning applies to `img` assets: a native Webflow Image resolves its `src` from an
asset id in `data.img`, so an external URL is discarded and the placeholder renders. Hence
images are emitted as Custom Elements.

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
