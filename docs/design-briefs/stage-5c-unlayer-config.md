# Stage 5C — Unlayer Configuration

**Companion to:** [stage-5c-html-composer-spec.md](stage-5c-html-composer-spec.md)
**PRD:** [#536](https://github.com/nico-kneler-as/as-comms-platform/issues/536) Brick B
**Last updated:** 2026-06-08
**Audience:** engineering (the Codex brief that wires Unlayer into the wizard)

This document specifies the exact configuration values to pass to `react-email-editor`'s `options` prop and `<EmailEditor>` props. Everything below is fixed by the design pass — engineering doesn't need to make any of these choices.

---

## 1. Library + mount strategy

**Library:** [`react-email-editor`](https://www.npmjs.com/package/react-email-editor) — **exact pin `1.8.5`** (see §9 for rationale). This is Unlayer's official React wrapper.

**Self-hosted iframe.** The editor renders inside an iframe that loads its core JS from `editor.unlayer.com` (the JS host, not the cloud editor service). No project ID, no Unlayer account, no design saved to Unlayer's servers — we persist the design tree ourselves via `body_design_json` (Brick A).

**Mount.** Lazy-loaded via `next/dynamic` with `ssr: false`. The wrapper component (`unlayer-host.tsx`) is the only thing imported from the compose step. Bundle impact: ~600 KB on the compose route only.

```tsx
// apps/web/app/broadcasts/new/_components/compose-step.tsx (sketch)
import dynamic from "next/dynamic";

const UnlayerHost = dynamic(
  () => import("./unlayer-host").then((m) => m.UnlayerHost),
  { ssr: false, loading: () => <EditorLoadingSkeleton /> },
);
```

---

## 2. `<EmailEditor>` props

```tsx
<EmailEditor
  ref={emailEditorRef}
  minHeight={720}              /* §3.5 of the spec */
  options={UNLAYER_OPTIONS}    /* §3 below */
  onLoad={handleLoad}          /* loads design / wires events */
  onReady={handleReady}        /* swaps loading skeleton to canvas */
/>
```

- `minHeight: 720` matches the spec's editor height (`h-[720px]`).
- `ref` lets the wizard call `editor.exportHtml(...)` and `editor.loadDesign(...)`.
- `onLoad` fires once Unlayer's JS bundle is fetched; use it to register event listeners only.
- `onReady` fires once the editor canvas is interactive; use it to (a) hide the loading skeleton and (b) call `editor.loadDesign(savedDesign)` if resuming.

---

## 3. `options` prop

The constant is exported from `unlayer-host.tsx` (or a sibling `unlayer-options.ts`). Top-level shape:

```ts
export const UNLAYER_OPTIONS = {
  displayMode: "email",
  appearance: APPEARANCE,
  tools: TOOLS,
  fonts: FONTS,
  mergeTags: MERGE_TAGS,
  features: FEATURES,
  safeHtml: true,
  customCSS: CUSTOM_CSS,
  customJS: CUSTOM_JS,
  iframe: { title: "Email body editor" },
} as const;
```

### 3.1 `displayMode`

```ts
displayMode: "email"
```

Email mode unlocks email-shaped controls (preheader settings, link tracking pixel toggle, etc). We don't expose Unlayer's preheader field to the operator (we have our own at the wizard level) but the mode is still correct.

### 3.2 `appearance`

```ts
const APPEARANCE = {
  theme: "modern_light",
  loader: { html: "" },                              // suppress branded spinner
  panels: {
    tools: {
      dock: "left",                                  // matches wizard reading direction
      collapsible: false,                            // operators shouldn't be able to hide it
      tabs: { content: { position: "top" } },
    },
  },
} as const;
```

**Why `modern_light`:** the cleanest of the four bundled themes. Closest to the platform's slate palette out of the box; we paint over the remaining accent with `customCSS` (§3.8).

**Why suppress the loader:** the spec calls for our own skeleton (§4.3 of the spec). Unlayer's spinner is branded and clashes.

**Why `dock: "left"`:** the wizard reads left-to-right. The Markdown variant's toolbar is also at the top-left. Right-dock would invert the visual rhythm.

### 3.3 `tools`

Operators get exactly seven block types. Everything else is disabled.

```ts
const TOOLS = {
  // Enabled — operators need these
  heading:   { enabled: true },
  text:      { enabled: true },
  image:     { enabled: true,  properties: { src: { value: { url: "" } } } },
  button:    { enabled: true },
  divider:   { enabled: true },
  spacer:    { enabled: true },
  columns:   { enabled: true },

  // Disabled — out of scope for this carve-out
  menu:      { enabled: false },  // no nav menus in emails
  social:    { enabled: false },  // no social icons (out of scope)
  video:     { enabled: false },  // video in email is risky; defer
  html:      { enabled: false },  // operators must not paste raw HTML
  timer:     { enabled: false },  // countdown timers; not relevant
  form:      { enabled: false },  // forms in email are anti-pattern
  carousel:  { enabled: false },  // image carousels — too clientele-specific
} as const;
```

**Why exactly these seven:** operators ship project broadcasts that read like newsletters — headings, body text, the occasional image, a CTA button or two, vertical breathing room. Anything more is feature creep on a carve-out we're trying to ship small.

### 3.4 `fonts`

```ts
const FONTS = {
  showDefaultFonts: false,                           // we control the list
  customFonts: [
    {
      label: "Geist Sans",
      value: "'Geist Sans', system-ui, -apple-system, sans-serif",
      url: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap",
    },
    {
      label: "Source Serif 4",
      value: "'Source Serif 4', Georgia, serif",
      url: "https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400;600&display=swap",
    },
    { label: "Arial",            value: "Arial, Helvetica, sans-serif" },
    { label: "Helvetica",        value: "Helvetica, Arial, sans-serif" },
    { label: "Georgia",          value: "Georgia, 'Times New Roman', serif" },
    { label: "Times New Roman",  value: "'Times New Roman', Times, serif" },
  ],
} as const;
```

**Default body font:** Geist Sans. Matches the rest of the platform.

**Why only 6 fonts:** Operators shouldn't be picking from 25 webfonts. Geist Sans + Source Serif 4 are the platform fonts; the four email-safe fallbacks (Arial / Helvetica / Georgia / Times New Roman) cover Outlook recipients where webfonts don't load.

**Why ship Source Serif 4:** the platform's long-form body text uses it (per `design-tokens-v2.ts:150`). Some operators may want a serif voice for storytelling broadcasts.

### 3.5 `mergeTags`

> **Verify before Brick B:** Unlayer's documented merge-tag shape may use the literal tag value (`first_name`) as the map key rather than a camelCase alias. Confirm against Unlayer's published schema at brief-dispatch time and adjust the keys if needed; the `value` field is canonical regardless.

Identical to the Markdown variant — keep the contract surface stable.

```ts
const MERGE_TAGS = {
  firstName: {
    name: "First name",
    value: "{{firstName}}",
    sample: "Alex",
  },
  projectName: {
    name: "Project name",
    value: "{{projectName}}",
    sample: "Forests",
  },
  aliasEmail: {
    name: "Sender alias",
    value: "{{aliasEmail}}",
    sample: "forests@adventurescientists.org",
  },
} as const;
```

These are the same three tokens dropped from the Markdown composer's dropdown menu (compose-step.tsx:18-22). Sample values render in Unlayer's preview mode (which we don't use — we use our own preview in Step 5).

### 3.6 `iframe` attributes

```ts
iframe: { title: "Email body editor" }
```

This sets the `<iframe title>` on Unlayer's host iframe. Required for accessibility (per the brief and per WCAG H64).

### 3.7 `features`

> **Verify before Brick B:** Not every key below is documented in `react-email-editor` v1.8's public schema. `preview` and `preheaderText` are stable; `textEditor.spellChecker`, `smartMergeTags`, and `audit` should be confirmed against Unlayer's release notes or by reading the package's type definitions at brief-dispatch time. Any unrecognized key is silently ignored — not an error — but if a key is renamed, our intent leaks. Default to dropping unverified keys rather than hoping.

```ts
const FEATURES = {
  preview: false,             // we own preview at Step 5 — STABLE
  preheaderText: false,       // we own preheader at the wizard subject row — STABLE
  textEditor: { spellChecker: true },  // VERIFY
  smartMergeTags: true,       // typing "{{" surfaces the dropdown — VERIFY
  audit: false,               // VERIFY (likely Unlayer cloud-only)
} as const;
```

**Why disable Unlayer's preview:** we have our own preview surface at Step 5 (preview-step.tsx). Surfacing Unlayer's would confuse operators about which is canonical.

**Why disable Unlayer's preheader field:** ditto — we have it at the wizard subject row.

### 3.8 `customCSS` — toolbar palette overrides

The brief asks for the platform palette (slate-900 active, slate-100 hover, white background) on Unlayer's toolbar. `appearance.theme: 'modern_light'` gets close but uses Unlayer's default purple-blue accent. We paint over it with surgical CSS:

```css
/* Injected into Unlayer's iframe via options.customCSS */

/* Active tool button — slate-900 */
.blockbuilder-content-tool[aria-selected="true"],
.blockbuilder-content-tool.active,
.actions-container .btn-primary {
  background-color: #0f172a !important;
  border-color: #0f172a !important;
  color: #ffffff !important;
}

/* Hover on tool button — slate-100 */
.blockbuilder-content-tool:hover:not([aria-selected="true"]):not(.active) {
  background-color: #f1f5f9 !important;
}

/* Properties panel accent color — slate-700 (text) */
.property-tools button.active,
.property-tools button[aria-pressed="true"] {
  color: #334155 !important;
}

/* Primary action button (Save / Done if visible) — slate-900 */
.action-bar .btn-primary {
  background-color: #0f172a !important;
  border-color: #0f172a !important;
}
.action-bar .btn-primary:hover {
  background-color: #1e293b !important;
}

/* Drag-target highlight — slate-200 (lighter than Unlayer's default blue) */
.drag-target.drop-zone {
  border-color: #cbd5e1 !important;
  background-color: rgba(241, 245, 249, 0.6) !important;
}
```

Pass as a string (Unlayer accepts string or array of strings). Use a tagged template literal so the CSS stays editable next to the comment that documents each rule:

```ts
const CUSTOM_CSS = `
/* Active tool button — slate-900 */
.blockbuilder-content-tool[aria-selected="true"],
.blockbuilder-content-tool.active,
.actions-container .btn-primary {
  background-color: #0f172a !important;
  border-color: #0f172a !important;
  color: #ffffff !important;
}

/* Hover on tool button — slate-100 */
.blockbuilder-content-tool:hover:not([aria-selected="true"]):not(.active) {
  background-color: #f1f5f9 !important;
}

/* Properties panel accent color — slate-700 (text) */
.property-tools button.active,
.property-tools button[aria-pressed="true"] {
  color: #334155 !important;
}

/* Primary action button (Save / Done if visible) — slate-900 */
.action-bar .btn-primary {
  background-color: #0f172a !important;
  border-color: #0f172a !important;
}
.action-bar .btn-primary:hover {
  background-color: #1e293b !important;
}

/* Drag-target highlight — slate-200 (lighter than Unlayer's default blue) */
.drag-target.drop-zone {
  border-color: #cbd5e1 !important;
  background-color: rgba(241, 245, 249, 0.6) !important;
}
` as const;
```

(The duplicated `<style>` block above is the same CSS — keep one copy. The block earlier in §3.8 was the design intent; this is the engineering payload.)

**Note on `!important`:** Unlayer's iframe ships its own inline styles that win without `!important`. This is the documented workaround in their forum threads. Acceptable for a vendor's internal CSS we're targeting deliberately.

**Brittleness risk:** Unlayer class names can change between minor versions. Pin `react-email-editor` to an exact version (not `^1.8.0`) and revalidate the customCSS on every upgrade.

### 3.9 `customJS` — locked footer block (see §5 below)

The locked footer block is registered via `customJS` because it requires running a tool-registration call inside the iframe. See §5 for the full registration code.

---

## 4. Brand defaults — initial design tree

When the operator lands on Step 4 for the first time (empty / first-load state), engineering calls `editor.loadDesign(BRAND_DEFAULT_STARTER)` with this design tree:

```ts
// NEXT_PUBLIC_APP_URL is REQUIRED. The starter's logo cannot fall through to a
// relative path — Gmail's image proxy treats relative URLs inconsistently.
// Engineering: read at module-init and throw on null/empty so misconfigured
// environments fail loud, not silently.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL;
if (!APP_URL) {
  throw new Error(
    "NEXT_PUBLIC_APP_URL is required for the broadcast HTML composer brand-default starter",
  );
}

export const BRAND_DEFAULT_STARTER = {
  // Counters set to the next available slot AFTER the placed contents below
  // (img-1, text-1, footer-html-1 consume index 1 of their respective namespaces).
  counters: { u_column: 4, u_row: 4, u_content_text: 2, u_content_image: 2, u_content_html: 2 },
  body: {
    id: "body",
    rows: [
      {
        id: "row-1",
        cells: [1],
        columns: [
          {
            id: "col-1",
            contents: [
              {
                id: "img-1",
                type: "image",
                values: {
                  src: {
                    url: `${APP_URL}/brand/as-mark.png`,
                    width: 512,
                    height: 512,
                  },
                  altText: "Adventure Scientists",
                  textAlign: "center",
                  containerPadding: "16px",
                  // Render at 64x64 in the email
                  size: { autoWidth: false, width: "64px" },
                },
              },
            ],
            values: {
              backgroundColor: "#ffffff",
              padding: "0px",
            },
          },
        ],
        values: {
          backgroundColor: "#ffffff",
          columnsBackgroundColor: "#ffffff",
          padding: "16px 0 0 0",
        },
      },
      {
        id: "row-2",
        cells: [1],
        columns: [
          {
            id: "col-2",
            contents: [
              {
                id: "text-1",
                type: "text",
                values: {
                  text: '<p style="font-family: \'Geist Sans\', system-ui, sans-serif; font-size: 16px; line-height: 1.6; color: #334155; margin: 0;">Write your message here…</p>',
                  containerPadding: "24px 32px",
                  fontFamily: { label: "Geist Sans", value: "'Geist Sans', system-ui, sans-serif" },
                  fontSize: "16px",
                  color: "#334155",
                  textAlign: "left",
                  lineHeight: "160%",
                },
              },
            ],
            values: { backgroundColor: "#ffffff", padding: "0px" },
          },
        ],
        values: {
          backgroundColor: "#ffffff",
          columnsBackgroundColor: "#ffffff",
          padding: "0px",
        },
      },
      {
        // LOCKED footer row — see §5 for the locking strategy
        id: "row-3",
        cells: [1],
        locked: true,
        columns: [
          {
            id: "col-3",
            contents: [
              {
                id: "footer-html-1",
                type: "html",
                values: {
                  html: FOOTER_HTML, // string constant — see §5.2
                  containerPadding: "0px 32px 24px 32px",
                  locked: true,
                },
              },
            ],
            values: { backgroundColor: "#ffffff", padding: "0px" },
          },
        ],
        values: {
          backgroundColor: "#ffffff",
          columnsBackgroundColor: "#ffffff",
          padding: "0px",
        },
      },
    ],
    values: {
      backgroundColor: "#ffffff",
      contentWidth: "600px",
      fontFamily: { label: "Geist Sans", value: "'Geist Sans', system-ui, sans-serif" },
      preheaderText: "",
    },
  },
  schemaVersion: 7,
} as const;
```

**Two critical defaults at the `body.values` level:**

- `contentWidth: "600px"` — the canonical desktop email body width. Matches Postmark templates and Gmail's default rendering width.
- `fontFamily` set to Geist Sans inheritable from `body` — every new block the operator adds inherits Geist Sans without them choosing.

**Logo URL:** Resolves via `NEXT_PUBLIC_APP_URL` at build time. In production: `https://comms.adventurescientists.org/brand/as-mark.png`. In dev: `http://localhost:3000/brand/as-mark.png`.

**Logo dimensions:** Asset is 512×512 (square). We render at 64×64 in the email — small, clean, recognizable. If a wider wordmark variant is commissioned later, swap the URL and bump width. Out of scope for this PRD.

---

## 5. Locked footer block strategy

The brand-default starter includes a footer row that operators cannot delete, duplicate, edit, or drag. Unlayer's self-hosted edition supports row-level and content-level `locked: true`, but the protection is editor-side only — a determined operator inspecting the iframe could still mutate. Acceptable risk; the backend's `buildUnsubscribeFooter` is the authoritative source for what actually ships.

### 5.1 Locking the row + content block

Two `locked: true` flags in the design tree (already shown in §4):

- `body.rows[2].locked: true` — row-level lock. Operator cannot drag the row away, cannot delete it via the row's `×` button, cannot duplicate it.
- `body.rows[2].columns[0].contents[0].values.locked: true` — content-level lock. Operator cannot click into the HTML block to edit its source.

Both are honored by `react-email-editor` v1.7+ per Unlayer's changelog.

### 5.2 `FOOTER_HTML` constant

This is the WYSIWYG preview of what `buildUnsubscribeFooter` ([campaign-send-orchestrator.ts:109-148](../../packages/domain/src/campaign-send-orchestrator.ts)) will inject at send time. The two must stay in sync; ideally engineering imports this string from the domain package so there's one source.

```html
<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 16px;">
<div style="color:#64748b;font-size:12px;line-height:1.6;">
  <a href="#" target="_blank" rel="noreferrer noopener" style="color:#64748b;text-decoration:underline;">Unsubscribe from {{projectName}} emails</a>
  &middot;
  <a href="#" target="_blank" rel="noreferrer noopener" style="color:#64748b;text-decoration:underline;">Unsubscribe from all Adventure Scientists emails</a>
</div>
<div style="color:#64748b;font-size:12px;line-height:1.6;margin-top:8px;">
  Adventure Scientists • 1881 9th St, Suite 201 • Bozeman, MT 59715
</div>
```

`target="_blank" rel="noreferrer noopener"` mirrors `buildUnsubscribeFooter`'s anchor attributes verbatim ([campaign-send-orchestrator.ts:130,132-133](../../packages/domain/src/campaign-send-orchestrator.ts)). The address separator is the bullet character `•` (U+2022, space-padded) to match `formatOrgAddress`'s join at [campaign-send-orchestrator.ts:106](../../packages/domain/src/campaign-send-orchestrator.ts) — not `&middot;` (U+00B7) which would render slightly differently.

**Live URLs vs `#`:** the in-editor preview uses `#` because real unsubscribe URLs are per-recipient and not known at compose time. At send time, **the worker always appends `buildUnsubscribeFooter` regardless**, and Brick B/C engineering adds a one-line de-dup pass that detects and removes the locked footer block from the operator's HTML by `data-content-id="footer-html-1"` (the stable id assigned at §4 line `id: "footer-html-1"`). Single rule: append always, strip the in-canvas preview if present. No conditional append logic; one code path; the canvas footer is purely operator-facing.

**Address line:** the spec shows the Bozeman address as a placeholder. Engineering: pull from `OrgSettingsRecord` at compose time so the preview shows the actual configured address — same source `formatOrgAddress` reads at send time.

### 5.3 If row-level lock doesn't hold on this Unlayer version

Fallback: skip the locked footer block entirely from the starter. Add a Stage 5A-style hint above the editor: "Don't add an unsubscribe footer — Adventure Scientists adds one automatically when this is sent." Operators just won't see the WYSIWYG footer preview at compose time. Acceptable degradation.

---

## 6. Save / load lifecycle

### Save (operator hits Continue or autosave fires)

```ts
emailEditorRef.current?.exportHtml((data) => {
  // data.design is the JSON tree (persist as body_design_json)
  // data.html   is the rendered HTML (persist as bodyHtmlTemplate)
  // data.text   is the plaintext fallback (persist as bodyTextTemplate)
  onSave({
    bodyDesignJson: data.design,
    bodyHtml: data.html,
    bodyPlaintext: data.text,
  });
});
```

### Load (resume from saved draft)

```ts
useEffect(() => {
  if (!ready) return;
  if (savedDesign === null) {
    // First load: empty / first-load state — apply BRAND_DEFAULT_STARTER
    emailEditorRef.current?.loadDesign(BRAND_DEFAULT_STARTER);
  } else {
    // Resume: apply the operator's saved design tree
    emailEditorRef.current?.loadDesign(savedDesign);
  }
}, [ready, savedDesign]);
```

### Autosave debounce

Recommended: 1500ms debounce on Unlayer's `design:updated` event. Matches the Markdown variant's autosave cadence.

### Size check

After every save, measure `JSON.stringify(data.design).length`:

- ≥ 500,000 bytes → set `softSizeWarning = true` (state §4.5 of the spec)
- ≥ 2,000,000 bytes → set `hardSizeError = true` (state §4.6 of the spec)
- Otherwise clear both

---

## 7. Plaintext fallback quality

Per the PRD, plaintext is derived from `exportHtml().text`. Unlayer's plaintext output:

- Converts headings to plain text
- Preserves paragraph breaks via blank lines
- Converts buttons to `[label] (url)` form — readable but not ideal
- Converts images to `[alt text]` form — fine
- Strips inline styles — fine

Known weakness: tables with cells stacked vertically (e.g., a two-column image+text row) come out interleaved in plaintext. Visible only to recipients who have HTML disabled (a tiny minority).

**Mitigation:** post-Brick C, the architect manually inspects 3-5 plaintext outputs from real sends. If quality is poor, escalate to a follow-up brick that runs `html-to-text` on the HTML output instead. Out of scope for Brick B.

---

## 8. Sample Codex brief snippet (for the architect to lift)

When dispatching Brick B, the relevant config block in the brief becomes:

```
Mount Unlayer via `react-email-editor`. Pass the options constant from
`apps/web/app/broadcasts/new/_components/unlayer-options.ts`, which you
will create with the exact contents specified in
`docs/design-briefs/stage-5c-unlayer-config.md` §3-§4. Do not modify
the constants. Do not invent additional options keys. If a spec value
appears ambiguous, leave a `// QUESTION` comment and stop — do not
guess.
```

This keeps Codex from going off-script on options the spec didn't authorize.

---

## 9. Version pin

```
"react-email-editor": "1.8.5"
```

Exact-pin (no `^`). Unlayer's class names and option keys have drifted between minor versions; we revalidate before bumping.
