# Stage 5C HTML Composer — Design Specification

**PRD:** [#536](https://github.com/nico-kneler-as/as-comms-platform/issues/536) — Stage 5C carve-out: HTML composer for project broadcasts
**Brief:** [docs/design-briefs/stage-5c-html-composer.md](stage-5c-html-composer.md) (the requirements)
**Parent design language:** [docs/design-briefs/stage-5a-campaigns.md](stage-5a-campaigns.md)
**Tokens:** [apps/web/app/\_lib/design-tokens-v2.ts](../../apps/web/app/_lib/design-tokens-v2.ts)
**Last updated:** 2026-06-08
**Historical note:** Historical design brief — HTML composer (D-050) and SMS broadcasts have since shipped; see `campaigns-bundle.md`.
**Scope:** Step 4 (Compose) `html_email` variant + small Step 1 delta. All other wizard steps inherit Stage 5A unchanged.

---

## 1. Inheritance from Stage 5A

The HTML composer is the Markdown composer with its body block swapped for an Unlayer iframe. Everything else is reused without modification:

| Surface                                     | Inherited from            | Notes                                                                                                       |
| ------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Step rail (left side, vertical progression) | `wizard-shell.tsx`        | Unchanged                                                                                                   |
| Step header (`<StepHeader>`)                | `wizard-shell.tsx`        | Title + description only — copy below                                                                       |
| Subject input row                           | `compose-step.tsx:66-93`  | Verbatim, including `46px` label gutter and `14.5px/font-semibold` input                                    |
| Preheader input row                         | `compose-step.tsx:95-113` | Verbatim, including `12.5px` input and "Preview" label                                                      |
| Footer (Back / Continue)                    | `<WizardFooter>`          | Unchanged Back/Continue behavior                                                                            |
| Outer card                                  | `compose-step.tsx:65`     | Same `overflow-hidden rounded-xl border border-slate-200 bg-white` outer frame; body slot is the only delta |

The composer card looks like the Markdown composer card. The differences are inside the body slot.

### Visual rhythm anchor

```
┌─ <StepHeader title="Compose your HTML email" desc="…" />
│
├─ Compose card (overflow-hidden rounded-xl border-slate-200 bg-white)
│   ├─ Subject row       — same as Markdown variant
│   ├─ Preheader row     — same as Markdown variant
│   └─ Body slot         — Unlayer iframe + per-state chrome (this spec)
│
└─ <WizardFooter />
```

---

## 2. Step header copy

```
Title:       Compose your HTML email
Description: Drag blocks onto the canvas to build the message. Subject and preheader
             above are what recipients see in their inbox. Preview opens on the next
             step.
```

Token: `text-balance text-xl font-semibold tracking-tight text-slate-900` (title) + `text-[13px] leading-relaxed text-slate-500` (description) — same `<StepHeader>` component.

---

## 3. Body slot anatomy

The body slot sits below the Preheader row inside the same compose card. It has three vertical bands:

1. **Editor band** — Unlayer iframe, full content width, default height `720px` (more rationale below).
2. **Status / warning band** — collapses to zero height when there's nothing to say; otherwise renders a single warning ribbon at the top of the editor band (sticky inside the card, not the page).
3. **Helper band** — bottom row, slate-500 microcopy + word-count substitute (block count).

### Editor band — default state

```
┌─────────────────────────────────────────────────────────────────────┐
│ ⟨ Unlayer iframe — 720px tall, full card width ⟩                    │
│                                                                     │
│   left rail: tools dock (text, image, button, divider, columns,     │
│              spacer, heading)                                       │
│   center:    drag-and-drop canvas, white background, 600px wide     │
│   right:     properties / settings panel (collapsible)              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Height rationale:** 720px gives the operator one above-the-fold scroll worth of canvas on a 1440×900 laptop. Less and they're scrolling within Unlayer's scrollbar AND the wizard's scrollbar simultaneously, which is a known confusion point. More and the Continue button drops off the visible page on common laptop sizes. Engineering: do not let the Unlayer iframe resize the wizard page itself — keep wizard page height stable, scroll inside the iframe.

**Expandability — deferred.** The brief notes the editor should be "expandable". This spec narrows that to a **fixed 720px** for Brick B; expandability ships in a follow-up brick only if test-send feedback proves the fixed height is restrictive. Reason: shipping the expand interaction requires a state machine for "expanded vs collapsed", layout-shift accounting in the wizard column, and an extra accessibility audit. None of that is essential to validate the editor's UX with operators.

**Width:** matches the compose card's inner width (which is itself the wizard column width, ~960px maximum, narrower on smaller viewports). Unlayer renders its own canvas at 600px and centers it — that's correct behavior because 600px is the canonical desktop email width. Do not override.

### Status / warning band

A horizontal slot between the Preheader row and the Editor band. **Zero height when empty** (no border, no padding — it does not reserve vertical space). When one or more ribbons fire (size warning §4.5, hard size error §4.6, deleted-variable warning §4.7), they stack vertically inside this band, top-most being the most severe (rose-toned hard errors above amber-toned warnings).

**Container tokens (per ribbon):**

- Spacing: `border-b border-{tone}-200 px-4 py-2.5`
- Background: `bg-{tone}-50/60` (amber for warning, rose for error)
- Layout: `flex items-start gap-2.5`

**Stacking rule.** Two ribbons in the band sit one above the other with **no inter-ribbon gap** — each contributes its own `border-b`, and the cumulative border treatment reads as a single tinted block. The Editor band's top edge stays flush with whichever ribbon is bottom-most.

**Dismissibility.** Warning-class ribbons (amber) include an `X` dismiss button at the far right (`text-{tone}-700/70 size-3.5`). Error-class ribbons (rose) do not — they're blocking.

### Helper band

Below the iframe, inside the same card, a single thin row:

```
┌─────────────────────────────────────────────────────────────────────┐
│ ⓘ The AS unsubscribe footer is added automatically.                 ┃ 4 blocks
│   You don't need to add one.                                        ┃
└─────────────────────────────────────────────────────────────────────┘
```

- Left side: `text-[11px] text-slate-500`, prefixed with the `Info` lucide icon at `size-3` and `text-slate-500`. Copy is verbatim from the brief — see §8 microcopy index.
- Right side: `text-[10.5px] font-mono tabular-nums text-slate-500` — Unlayer's block count as a substitute for "words" (we can't count words inside an iframe-hosted HTML editor without a roundtrip). Word-count surfaces in the Markdown variant; block-count is its closest analog here.
- Border-top: `border-t border-slate-200`, background `bg-slate-50/70` — mirrors the Markdown variant's `toolbarFooter` slot.

### Save-state indicator (autosave)

Inherits the Markdown variant verbatim — same wording, same position, same timing, same component as `compose-step.tsx`'s autosave indicator. Placement: inside the Helper band, between the footer-reassurance text and the block-count chip. Cadence: re-renders on every successful save (debounced to 1500ms; see [stage-5c-unlayer-config.md §6](stage-5c-unlayer-config.md#6-save--load-lifecycle)).

If the Markdown variant doesn't yet ship a visible autosave indicator (today it's implicit — autosave fires on `onBodyChange`), then the HTML composer inherits the same implicit posture: no visible indicator. **Do not introduce an HTML-only autosave indicator** — keep parity with the Markdown path.

---

## 4. State catalog

Six states. Each section gives: visual description → exact tokens → microcopy → interaction.

### 4.1 Empty / first-load (brand-default starter)

**When it shows.** Operator just picked HTML Email at Step 1 and reached Step 4 for the first time on this draft.

**Visual.** Unlayer iframe loads with three blocks pre-placed on the canvas:

1. **Logo header block** — single image block, centered, ~64px tall, AS mark sourced from `/brand/as-mark.png`. Below the logo, a small text line: `Adventure Scientists` set in Geist Sans 14px bold slate-900.
2. **Body text block** — single rich-text block, placeholder text "Write your message here…" set in Geist Sans 16px slate-700 with `font-weight: 400`. Caret-ready when operator clicks in.
3. **Footer block (locked)** — single locked HTML block that previews the auto-appended footer. Visual:
   - `<hr>` slate-200 1px, 24px margin top, 16px bottom
   - Unsubscribe link row in slate-500 12px: "Unsubscribe from {{projectName}} emails · Unsubscribe from all Adventure Scientists emails"
   - Address line in slate-500 12px

   The footer block is a custom Unlayer tool registered as **non-removable, non-editable, non-draggable**. It exists purely as a WYSIWYG preview of what the system will append. See [stage-5c-unlayer-config.md §5](stage-5c-unlayer-config.md) for the registration code.

**Why a locked block, not nothing.** Two competing forces: (a) the brief says operators shouldn't add their own footer because the system appends one, and (b) the brief says the starter should include "AS footer block matching the existing Stage 5A email footer". A locked block satisfies both — operators see the final shape end-to-end from the moment they land on Step 4, and they cannot accidentally delete, edit, or duplicate the compliance language.

**Tokens.**

- Logo image src: `/brand/as-mark.png` (rendered at 64x64 — engineering passes the absolute URL via `APP_URL + '/brand/as-mark.png'`)
- Body text default font: Geist Sans 16px / line-height 1.6 / color #334155 (slate-700)
- Footer styling: mirrors `buildUnsubscribeFooter`'s inline-style output from [campaign-send-orchestrator.ts:137-143](../../packages/domain/src/campaign-send-orchestrator.ts), including `target="_blank" rel="noreferrer noopener"` on both anchor tags. The exact constant lives at [stage-5c-unlayer-config.md §5.2](stage-5c-unlayer-config.md) and is the single source of truth for the in-canvas preview; engineering should re-export from the domain package rather than duplicate.

**Microcopy.** Placeholder body: `Write your message here…` (with the trailing ellipsis, not three dots).

**Interaction.** No focus auto-stolen by the iframe (per brief). Operator clicks into the body block to start typing.

### 4.2 Resume / saved draft

**When it shows.** Operator returns to a draft they were editing previously. The wizard reads `bodyDesignJson` from the campaign run and passes it to Unlayer's `loadDesign()`.

**Visual.** Same iframe footprint. Inside, Unlayer renders the operator's last-saved design tree. The locked footer block reappears at the bottom (engineering: if the persisted design tree does not contain the footer block, inject it on load — operators should not be able to "save a draft without the footer block" in a way that survives across sessions).

**Loading lifecycle.** Between mount and rehydration (~200-500ms typical):

- Render the **Loading** state (§4.3) over the iframe area.
- Once Unlayer's `editor:ready` event fires AND `loadDesign()` resolves, swap to the Resume state.

**Tokens.** No new tokens — the resumed canvas is whatever the operator saved, plus the locked footer.

**Microcopy.** None — the resume happens invisibly. No "Draft loaded" toast (it would just be noise).

**Interaction.** Focus stays on the page where the user landed (typically the subject row if they tabbed into the wizard); does not auto-focus into the iframe.

### 4.3 Loading

**When it shows.**

- Initial mount before Unlayer's iframe has emitted `editor:ready`.
- Resume path, between mount and `loadDesign` resolving.

**Visual.** A skeleton overlay sized to match the eventual editor footprint exactly. Three rectangles in a layout that hints at Unlayer's three-pane structure:

```
┌──────┬────────────────────────────┬───────┐
│      │  ░░░░░░░░░░░░░░░░░░░░░░░░  │       │
│ ░░░░ │  ░░░░░░░░░░░░░░░░░░░░░░░░  │ ░░░░  │
│ ░░░░ │                            │ ░░░░  │
│ ░░░░ │  ░░░░░░░░░░░░░░░░░░░░░░░░  │ ░░░░  │
│      │  ░░░░░░░░░░░░░░░░░░░░░░░░  │       │
└──────┴────────────────────────────┴───────┘
```

**Tokens.**

- Outer container: `h-[720px] w-full rounded-md border border-slate-200 bg-slate-50` (the same border-radius the iframe will inherit)
- Skeleton bars: `bg-slate-200 animate-pulse rounded` (Tailwind motion-safe pulse). For `motion-reduce`, swap to static `bg-slate-200`.
- Tool rail skeleton: left column 64px wide, 6 bars (each `h-8 w-10` with `gap-2`)
- Canvas skeleton: center column, 600px max-width, 3 bars stacked (heights `h-16`, `h-32`, `h-8`)
- Properties rail skeleton: right column 240px wide, 4 bars (each `h-6 w-32`)
- No spinner. **Do not** show Unlayer's branded loading spinner — engineering should set `appearance.loader.html: ''` to suppress it.

**Microcopy.** Visually-hidden `aria-live="polite"` region announcing "Loading the email editor" on mount; cleared once ready.

**Interaction.** Continue button in the WizardFooter is **disabled** while loading (same disable condition as `editor failed to load` — operator cannot submit a draft from an editor that hasn't loaded).

### 4.4 Editor failed to load

**When it shows.** Three triggers:

- Mount timeout (no `editor:ready` event within 10 seconds)
- JS error inside Unlayer's iframe (caught via `window.addEventListener('error')` filtered to the iframe origin)
- Network error fetching `react-email-editor`'s Unlayer host (e.g., embed.unlayer.com unreachable)

**Visual.** Replaces the entire body slot (where the iframe would be) with a calm inline panel:

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│            ⚠  The editor couldn't load.                             │
│                                                                     │
│            Reload the page and try again — your draft is saved.     │
│                                                                     │
│            ┌──────────┐                                             │
│            │  Reload  │                                             │
│            └──────────┘                                             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Tokens.**

- Container: `h-[720px] w-full rounded-md border border-amber-200 bg-amber-50/40 flex flex-col items-center justify-center px-6`
- Icon: `<AlertTriangle>` lucide, `size-6 text-amber-700`
- Title line: `text-[13.5px] font-semibold text-amber-900 mt-3`
- Body line: `text-[12.5px] text-amber-800/90 mt-1 max-w-[420px] text-center`
- Reload button: `<Button variant="outline" size="sm" className="mt-4 gap-1.5">` with `<RefreshCw className="size-3.5">` icon

**Microcopy.**

- Title (visually emphasized): "The editor couldn't load."
- Body: "Reload the page and try again — your draft is saved."
- Button: "Reload"
- (Aria-live `polite`) announcement: "The email editor failed to load. Reload the page to try again."

**Interaction.**

- **Continue button is disabled** until the editor reloads successfully (this is non-negotiable per the brief — operator cannot submit a broken draft).
- Reload button calls `window.location.reload()` — simpler than retry-in-place because Unlayer's bootstrap state is hard to reset cleanly.

### 4.5 Design too large to save — soft warning

**When it shows.** After Unlayer's `design:updated` event fires, engineering serializes the design tree, measures byte length, and compares against soft limit.

- **Soft limit:** 500 KB serialized JSON
- **Hard limit:** 2 MB serialized JSON (next section)

**Visual.** A non-blocking warning ribbon at the top of the editor band (between the preheader row and the iframe — inside the same card, not floating). The ribbon shrinks the iframe by its own height; the iframe stays usable.

```
┌─────────────────────────────────────────────────────────────────────┐
│ ⚠  This design is getting large. Consider linking images instead    │
│    of embedding.                                            ✕       │
└─────────────────────────────────────────────────────────────────────┘
```

**Tokens.**

- Container: `flex items-start gap-2.5 border-b border-amber-200 bg-amber-50/60 px-4 py-2.5`
- Icon: `<AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700">`
- Text: `text-[12.5px] text-amber-900 leading-relaxed`
- Dismiss button: `<button aria-label="Dismiss warning">` with `<X className="size-3.5 text-amber-700/70">`
- **Shape note:** this is a horizontal band ribbon (full-width, `border-b`) — visually distinct from the rounded card-style amber ribbon at [preview-step.tsx:105](../../apps/web/app/broadcasts/new/_components/preview-step.tsx) which uses `rounded-lg border border-amber-300`. The compose-step uses the band shape because it sticks to the top of the body slot inside an already-rounded card; the preview-step uses the card shape because it floats above the preview panel without a parent card. Same palette tone (amber), different geometry by container context.

**Microcopy.**

- "This design is getting large. Consider linking images instead of embedding."

**Interaction.**

- Dismiss persists for the current draft session only (in component state, not persisted). It reappears if the design grows another 100 KB after dismiss — operators should not be able to mute it permanently.
- Continue is **still enabled** at the soft threshold.

### 4.6 Design too large to save — hard error

**When it shows.** Serialized design exceeds 2 MB.

**Visual.** The ribbon stays where the soft warning was, but flips to error styling, and adds disabling to the Continue button.

**Tokens.**

- Container: `flex items-start gap-2.5 border-b border-rose-200 bg-rose-50/70 px-4 py-2.5`
- Icon: `<AlertOctagon className="mt-0.5 size-4 shrink-0 text-rose-700">`
- Text: `text-[12.5px] text-rose-900 leading-relaxed`
- No dismiss button (this is a blocker, not a warning).

**Microcopy.**

- "This design is too large to save. Reduce image sizes or remove blocks."

**Interaction.**

- Continue button is **disabled** with title attribute "Reduce design size to continue."
- Continue re-enables automatically when the design drops back below 2 MB.

### 4.7 Deleted-variable warning

**When it shows.** Operator inserts a merge variable (e.g., `{{firstName}}`) into an Unlayer block, but the underlying merge field no longer resolves for the audience — typically because audience filters changed and now include contacts where that field is null.

**Reuse, don't reimplement.** The detection pipeline at [audience-data-source.ts:803](../../apps/web/app/broadcasts/_lib/audience-data-source.ts) and [preview-step.tsx:91-95](../../apps/web/app/broadcasts/new/_components/preview-step.tsx) already produces `previewData.warningCount` by scanning resolved HTML samples. **The only delta in Brick B is that `sample.html` now comes from `editor.exportHtml()` instead of the markdown renderer** — the warning detection itself, the affected-contacts dialog, and the surface ribbon all reuse the Stage 5A pipeline unchanged. Engineering must NOT reimplement merge-token detection over Unlayer's design tree.

**Visual.** A warning chip floating above the affected block within the canvas, AND a summary ribbon at the top of the body slot.

The summary ribbon (above the iframe):

```
┌─────────────────────────────────────────────────────────────────────┐
│ ⚠  3 contacts will get a blank firstName.                           │
│    [Review affected contacts]                                       │
└─────────────────────────────────────────────────────────────────────┘
```

This is the same ribbon already shipped in Stage 5A (preview-step.tsx:104-131). Reuse it verbatim — same tokens, same `<Dialog>` for the affected-contacts list.

**Inline chip (inside the iframe):** This is the hard part. Unlayer doesn't expose a stable API to inject per-block decoration. Two options:

- **Option A — surface the chip outside the iframe only** (recommended). Skip the in-canvas chip; rely on the ribbon. Justification: the operator sees the chip the moment they leave Step 4 for Step 5 (preview), where it's clearer anyway. Adding in-canvas decoration via Unlayer's `customJS` is brittle.
- **Option B — register a custom Unlayer tool that wraps merge tags**. Engineering complexity is high; reject for Brick B.

**Spec recommendation: Option A only.** The ribbon is enough. The inline chip is deferred.

**Tokens.** Same as the existing Stage 5A merge-token warning ribbon — `border-amber-300 bg-amber-50/60` etc.

**Microcopy.**

- Singular: "1 contact will get a blank firstName."
- Plural: "N contacts will get a blank firstName."
- Action: "Review affected contacts" (opens the existing `<Dialog>` from preview-step.tsx:240-270)

**Interaction.** Operator can Proceed anyway (same button as Stage 5A); state of "warning dismissed" persists in wizard state across step navigation.

---

## 5. Step 1 — Launch type (small delta)

Today: [launch-type-step.tsx:26-34](../../apps/web/app/broadcasts/new/_components/launch-type-step.tsx) sets `html_email` as `disabled: true` with `tag: "COMING SOON"`. Disclaimer at the bottom reads "Phase A ships Normal Email only. HTML Email arrives once the drag-and-drop builder lands; SMS follows."

After Brick B:

- The `html_email` card has `disabled: false` and `tag: null`. All other props (icon, title, description) unchanged.
- Disclaimer copy changes to: **"SMS arrives once carrier approval lands."** (verbatim — no leading sentence about HTML)

No visual tokens change. No layout changes. This is a content-only delta.

---

## 6. Step 5 — Preview spot-check verdict

**Question from the brief:** does the existing iframe preview surface in Step 5 (preview-step.tsx) render Unlayer-shaped HTML faithfully, or does it need work?

**Answer: It needs a small but real refinement before Brick B can ship.**

### Why the current preview misrepresents Unlayer HTML

[preview-step.tsx:213-221](../../apps/web/app/broadcasts/new/_components/preview-step.tsx) renders the email body via:

```tsx
<article className="rounded-lg border border-slate-200 bg-white p-5">
  <div
    className={cn(
      "prose prose-sm max-w-none text-slate-800",
      "[&_a]:text-sky-700 [&_a]:underline [&_hr]:border-slate-200",
    )}
    dangerouslySetInnerHTML={{ __html: sample.html }}
  />
</article>
```

For Markdown-derived HTML (Stage 5A Normal Email path), this works — the Markdown editor outputs simple `<p>/<ul>/<h2>/<a>` tags that Tailwind Typography (`prose prose-sm`) styles consistently. The wrapper IS the layout.

For Unlayer HTML, the model breaks:

1. **Unlayer ships table-based emails.** Outputs are nested `<table>/<tr>/<td>` with inline styles for Outlook compatibility. The `prose prose-sm` class adds its own margins, line-heights, and `max-width: 65ch` constraints to descendant elements. These collide with Unlayer's inline styles, producing a layout that is _not_ what the recipient sees.

2. **`max-w-none` doesn't escape `prose`'s descendant rules.** `prose` styles target child elements via `:where(.prose > *)` selectors that fire on the body even with `max-w-none`. Result: paragraph margins are doubled, list bullets shift, button blocks (which Unlayer renders as styled `<table>` wrappers) get squeezed.

3. **Tailwind Typography doesn't know about Unlayer's column layouts.** Two-column blocks render as one stacked column with squished padding.

### Recommended Brick B addition: branch the preview on `launchType`

For `launchType === 'html_email'`, replace the prose `<div>` with a real `<iframe srcDoc={sample.html}>`:

```tsx
// Within the existing <article> wrapper at preview-step.tsx:213
{
  launchType === "html_email" ? (
    <iframe
      title="Email body preview"
      srcDoc={sample.html}
      className="block w-full rounded-md border border-slate-200"
      style={{ height: 720, background: "white" }}
      sandbox="allow-same-origin"
    />
  ) : (
    <div
      className={cn(
        "prose prose-sm max-w-none text-slate-800",
        "[&_a]:text-sky-700 [&_a]:underline [&_hr]:border-slate-200",
      )}
      dangerouslySetInnerHTML={{ __html: sample.html }}
    />
  );
}
```

**Why iframe and not just a different wrapper class.** Unlayer's HTML contains its own `<style>` tags, link colors, and font-family declarations. Rendering that inside the same DOM as the wizard means the wizard's Tailwind reset applies, the wizard's link styles apply, the wizard's body font applies — all wrong. An iframe is the only way to get the recipient's-eye view honestly.

**Prop threading note.** Neither `PreviewStepProps` ([preview-step.tsx:24-45](../../apps/web/app/broadcasts/new/_components/preview-step.tsx)) nor `ComposeStepProps` ([compose-step.tsx:24-37](../../apps/web/app/broadcasts/new/_components/compose-step.tsx)) currently exposes `launchType`. Brick B must thread it from the wizard state (`use-new-campaign-wizard-state.ts`) into both component prop interfaces. This is a ~5-minute addition but the spec calls it out so Codex doesn't get stuck looking for an existing prop.

**Height handling.** 720px is a reasonable default. Engineering can grow it dynamically by reading `iframe.contentDocument.documentElement.scrollHeight` after `iframe.onload`, but a static 720 covers the typical case.

**Sandbox.** `sandbox="allow-same-origin"` lets the iframe render its own styles and images. Do NOT allow `allow-scripts` (Unlayer's exported HTML has no scripts; if any appear, it's a corruption / injection and we should fail closed).

**Effort estimate for engineering:** ~45 minutes — the conditional render, threading `launchType` from wizard state into `ComposeStepProps` + `PreviewStepProps`, and one snapshot test. Goes in Brick B alongside the editor wiring.

### What stays the same in Step 5

- Audience summary, schedule controls, send button, all microcopy (per brief)
- The sample-rotation controls (Previous / Next, contact picker)
- The merge-token-gap warning ribbon
- The Send Test popover
- The frozen state
- The `<PreviewRow label="From|To|Subject|Preview">` envelope summary

**Only the body-render delta is needed.**

---

## 7. Accessibility

### Iframe

- `<iframe title="Email body editor">` — Unlayer's react-email-editor accepts `options.iframe.title`. Set it to this value in [stage-5c-unlayer-config.md §3.6](stage-5c-unlayer-config.md#36-iframe-attributes).
- Do NOT auto-focus into the iframe on mount (per brief). Operators using keyboard nav from the preheader row should land on the iframe's wrapper element next, where pressing Tab enters Unlayer's own keyboard nav loop.
- Operators on screen readers will be told "Email body editor, iframe" by VoiceOver / NVDA on focus.

### Loading & error states

- Loading: `aria-live="polite"` region announces "Loading the email editor" on mount, clears on ready.
- Error: `aria-live="polite"` region announces "The email editor failed to load. Reload the page to try again."
- The Reload button is the natural next tab stop after the error icon.

### Warnings

- Soft warning ribbon: `role="status"` (polite). Loud enough to be heard but not interruptive.
- Hard error ribbon: `role="alert"` (assertive). Operator needs to know Continue is now disabled.
- Continue button's disabled state announces via `aria-describedby` pointing to the ribbon text.

### Contrast (WCAG AA)

All token combinations specified above hit AA against white:

- `text-slate-500` (#64748b) on `bg-white` — 4.83:1 ✓
- `text-amber-900` (#78350f) on `bg-amber-50` (#fffbeb) — 8.71:1 ✓ (the spec uses `bg-amber-50/60`, 60% alpha-blended over white; effective bg ≈ `#fffdf1`, contrast is still ≥ 8:1 ✓)
- `text-rose-900` (#881337) on `bg-rose-50` (#fff1f2) — 9.92:1 ✓ (the spec uses `bg-rose-50/70`, 70% alpha-blended over white; effective bg ≈ `#fff5f6`, contrast is still ≥ 9:1 ✓)
- Unlayer's `modern_light` theme toolbar icons hit AA. The slate-900-on-white active state we configure in customCSS hits 16.78:1. ✓

---

## 8. Microcopy index (for engineering search)

| Where                            | Copy                                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step 4 header — title            | `Compose your HTML email`                                                                                                                               |
| Step 4 header — description      | `Drag blocks onto the canvas to build the message. Subject and preheader above are what recipients see in their inbox. Preview opens on the next step.` |
| Body block placeholder           | `Write your message here…`                                                                                                                              |
| Helper band — footer reassurance | `The AS unsubscribe footer is added automatically. You don't need to add one.`                                                                          |
| Loading announcement             | `Loading the email editor` (visually-hidden, aria-live)                                                                                                 |
| Editor-failed title              | `The editor couldn't load.`                                                                                                                             |
| Editor-failed body               | `Reload the page and try again — your draft is saved.`                                                                                                  |
| Editor-failed button             | `Reload`                                                                                                                                                |
| Editor-failed announcement       | `The email editor failed to load. Reload the page to try again.` (aria-live)                                                                            |
| Soft size warning                | `This design is getting large. Consider linking images instead of embedding.`                                                                           |
| Hard size error                  | `This design is too large to save. Reduce image sizes or remove blocks.`                                                                                |
| Continue disabled tooltip (hard) | `Reduce design size to continue.`                                                                                                                       |
| Merge-gap ribbon (singular)      | `1 contact will get a blank firstName.`                                                                                                                 |
| Merge-gap ribbon (plural)        | `N contacts will get a blank firstName.`                                                                                                                |
| Step 1 — disclaimer (new)        | `SMS arrives once carrier approval lands.`                                                                                                              |

---

## 9. Out of scope (do not extend in Brick B)

The brief is explicit; reproducing here as a check-the-work list:

- Templates library, saved snippets, brand-default variants
- HTML for `kind='newsletter'` broadcasts
- Step 5 visual overhaul beyond the iframe-preview delta in §6
- Inline per-block deleted-variable chip inside the Unlayer canvas (§4.7, deferred)
- Separate plaintext editor field — plaintext is derived from Unlayer's `exportHtml().text`
- Unsubscribe footer markup changes — Stage 5A footer template stays canonical

---

## 10. Engineering handoff checklist

Before dispatching Brick B to Codex:

- [ ] Confirm `react-email-editor@1.8.5` (exact pin per [stage-5c-unlayer-config.md §9](stage-5c-unlayer-config.md#9-version-pin)) is pre-installed in the parent worktree per architect memory rules
- [ ] Confirm the AS logo at `/brand/as-mark.png` is reachable from preview environments (no Vercel/Railway routing issues with the `/brand/*` path)
- [ ] Confirm `NEXT_PUBLIC_APP_URL` is configured at build time in every deploy environment — the brand-default starter's logo `src` resolves through it (no relative-path fallback; gmail's image proxy treats those inconsistently)
- [ ] Confirm the locked-footer custom block strategy works in self-hosted Unlayer (see [stage-5c-unlayer-config.md §5](stage-5c-unlayer-config.md) for the approach — if Unlayer's self-hosted edition doesn't support `registerTool`, fall back to injecting the footer block as a normal (deletable) block and warn the operator at submit if it's missing).
- [ ] Confirm `body_design_json` round-trips at the schema layer (Brick A, [PR #537](https://github.com/nico-kneler-as/as-comms-platform/pull/537)) before Brick B mounts the editor against it.
- [ ] Brief Codex to thread `launchType` from `use-new-campaign-wizard-state.ts` into `ComposeStepProps` AND `PreviewStepProps` — neither currently exposes it (§6 prop-threading note).
- [ ] Brief Codex to run `pnpm build` (in addition to typecheck + lint + boundaries) per the architect memory rule "Run pnpm build before pushing route.ts / page.tsx changes" — Brick B touches `compose-step.tsx` + `preview-step.tsx` which are transitively imported by `/broadcasts/new/page.tsx`.
- [ ] Spec the snapshot test for the preview-step `launchType === 'html_email'` branch using the [stage-5c-specimen.html](stage-5c-specimen.html) sample.

---

## 11. Specimen — rendering observations

The brand-default starter rendered as a self-contained email lives at [stage-5c-specimen.html](stage-5c-specimen.html). Open it in a browser to see exactly what recipients see for an empty / first-load draft (subject "Project broadcast — brand-default starter").

### What the specimen embodies

The specimen is the canonical Unlayer export shape:

- Outer 100%-width `<table>` with the page-background grey (`#f8fafc`)
- Inner 600px fixed-width `<table>` with white background
- All layout via nested presentation tables (Outlook 2019/365 requirement)
- All styles inline (Gmail web strips `<style>` blocks from many message contexts)
- Email-safe font stack: `'Geist Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif` — webfont attempted, system stack fallback. Outlook will skip Geist Sans (no webfont support) and fall through to Helvetica → Arial; acceptable degradation.
- VML / `mso-` properties present where they matter (`mso-line-height-rule:exactly` on spacers, the conditional Office settings block in `<head>`)
- Hidden preheader `<div>` reserved at the top of `<body>` — the wizard's preheader field populates this server-side at send time

### Expected-good in these clients (pending real-client verification)

The specimen follows the patterns Unlayer's own export emits and the patterns the existing Stage 5A footer already ships. By construction it should render correctly in:

- **Gmail web** — fixed-width 600px tables, hidden preheader, inline styles all hit the rendering path Gmail uses
- **Gmail mobile (iOS / Android app)** — auto-resize triggers because of `<meta name="viewport">`; 600px fixed-width tables get scaled, not letterboxed
- **Apple Mail (macOS, iOS)** — full webfont rendering, identical to the design
- **Outlook.com (web)** — same path as Gmail web; safe
- **Outlook 365 desktop (Windows)** — falls through to Helvetica/Arial for body text; VML / `mso-` declarations keep spacers exact

### What engineering should still verify before Brick B ships

This spec was authored without access to live Gmail/Outlook test accounts. Engineering should send the specimen to `nicolaskneler@gmail.com` (per architect memory) once Brick B is on Railway and confirm:

- [ ] **Gmail web** — the AS mark image loads from `comms.adventurescientists.org/brand/as-mark.png` (or the Railway-env equivalent) and is not blocked by Gmail's image proxy
- [ ] **Outlook 365 desktop** — the 1px `<hr>` substitute (border-top on a spacer cell) renders cleanly; older Outlook strips `<hr>` outright
- [ ] **Outlook 365 desktop** — the 64×64 image scales correctly; sometimes Outlook expands inline images. If it stretches, add `style="width:64px !important"` on the `<img>`.
- [ ] **iOS Mail** — the address line doesn't get auto-linkified into a tap-to-open-Maps blue link. Add `<style>a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; }</style>` in `<head>` if it does — but only if it does (every `<style>` injection is a small risk).
- [ ] **Dark mode** — Gmail and Outlook dark mode may invert background colors. The white inner table on a slate-50 outer wrapper is the most defensible posture, but check; if inversion is jarring, add `[data-ogsc] td` overrides in a `<style>` block.

**None of these are blockers for Brick B.** They're the standard "send a test, look at it" pass that always happens before turning an HTML composer loose on real audiences. Flag any findings back into this spec as §11 follow-ups.

### Limitations of the specimen as a design artifact

The specimen is the **empty / first-load** state. It does not show:

- Operator-added images (operator-uploaded ≠ AS mark)
- Operator-added buttons (Unlayer button blocks have their own button styling)
- Multi-column rows (Unlayer's two-column layouts collapse to single column on mobile)
- Custom-color text (the starter uses slate-700 only)

Engineering can extend the specimen post-Brick-B with worked examples of each, if the test-send pass surfaces issues that need worked examples to discuss.

---

## 12. Files engineering will touch

Per [PRD #536](https://github.com/nico-kneler-as/as-comms-platform/issues/536) Brick B section. This spec doesn't change that list — it just makes each file's job concrete:

| File                                                                       | Change                                                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `apps/web/app/broadcasts/new/_components/launch-type-step.tsx`             | §5 — flip `disabled`, drop `tag`, update disclaimer copy                        |
| `apps/web/app/broadcasts/new/_components/compose-step.tsx`                 | Branch on `launchType` to render `<UnlayerHost>` instead of the Markdown editor |
| `apps/web/app/broadcasts/new/_components/unlayer-host.tsx` (new)           | Renders all states in §4                                                        |
| `apps/web/app/broadcasts/new/_components/preview-step.tsx`                 | §6 — branch on `launchType`, render `<iframe srcDoc>` for `html_email`          |
| `apps/web/app/broadcasts/new/_components/use-new-campaign-wizard-state.ts` | Track `bodyDesignJson` plus derived HTML/plaintext                              |

The spec for the `<UnlayerHost>` component is this document. The Unlayer `options` prop it passes is [stage-5c-unlayer-config.md](stage-5c-unlayer-config.md).
