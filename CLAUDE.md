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
convertHtmlToWebflow(html, { nativeForms: true })
```

- `nativeForms` (default `false`, wired to the "Native Forms" toggle in the UI) — convert
  `<form>` and its fields into native Webflow form elements instead of Custom Elements.

Stylesheet adoption (see below) is **always on**, not behind a toggle.

---

## What the converter does

| HTML | Webflow |
| --- | --- |
| `div`, `header`, `footer`, `nav`, `main`, `article`, `aside`, `address`, `figure` | `Block` with `data.tag` |
| `section` | `Section` (its own element type) |
| `h1`–`h6`, `p`, `a`, `ul`/`ol`, `li`, `strong`/`b`, `em`/`i`, `blockquote` | native types |
| `img` | **Custom Element** — see gotchas |
| `style`, `script`, `link`, `noscript` | `HtmlEmbed` (Code Embed) |
| everything else (`form`, `table`, `svg`, `figcaption`…) | Custom Element (`type: "DOM"`) |
| `<form>` + fields, when `nativeForms` is on | `FormWrapper` → `FormForm` + Success/Error |

The **first** class on an element becomes a real Webflow style block; every remaining class is
passed through verbatim as a custom `class` attribute so external frameworks (Tailwind) still
match.

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

- **Media queries always go to the Code Embed**, including ones matching Webflow's own
  breakpoints. Mapping `max-width: 991px` → the `medium` variant is feasible but the
  breakpoint variant-key names are unverified — get a reference payload first.
- **Only the `main` (desktop) breakpoint** is produced for state variants.
- **Only 4 pseudo-states** are adopted: `:hover`, `:active`, `:focus`, `:focus-visible`.
  Others (`:visited`, `:first-child`, pseudo-*elements*) stay in the embed.
- **Leftover CSS is re-serialized by the browser**, so `transition: all 0.3s ease` comes back
  as `transition: 0.3s` (equivalent). If *nothing* in a `<style>` is adopted, the author's
  original text is kept verbatim instead.
- **Unsupported form input types** (`file`, `date`, `range`, `color`, `hidden`) fall back to
  Custom Elements — Webflow has no native field for them.
- **`img` loses Webflow's asset pipeline.** It is emitted as a Custom Element to preserve the
  external `src`; a native Image would need an uploaded asset id.
- `data.text` is emitted as `false` on elements containing text. Webflow sometimes writes
  `true`. Both paste correctly; the trigger is unverified.

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
