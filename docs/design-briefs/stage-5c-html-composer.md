# Stage 5C HTML Composer — UI Design Brief

**Audience:** product designer (separate claude-design session)
**Companion document:** [PRD #536](https://github.com/nico-kneler-as/as-comms-platform/issues/536)
**Parent design brief:** [docs/design-briefs/stage-5a-campaigns.md](stage-5a-campaigns.md)
**Scope:** Compose-step `html_email` variant only. All other wizard steps reuse Stage 5A surfaces unchanged.
**Last updated:** 2026-06-08
**Historical note:** Historical design brief — HTML composer (D-050) and SMS broadcasts have since shipped; see `campaigns-bundle.md`.

---

## Context

We shipped Stage 5A (Email Broadcasts, Markdown composer, Postmark) and operators are sending project broadcasts in production. The launch-type picker already shows an **HTML Email** card grayed out with "Coming soon" — this brief is the design pass that unblocks it.

The carve-out is **just the HTML composer for project broadcasts**. Newsletter migration off Mailchimp and Mailchimp decommission remain Stage 5C work, deferred until this composer is operator-validated. Postmark stays on the Basic 10K tier. `kind` stays restricted to `'project'`.

Editor library is locked: **Unlayer's `react-email-editor`**, self-hosted iframe, no Unlayer cloud dependency. This brief does not need to redesign Unlayer's chrome — but it does need to design how Unlayer sits inside the existing wizard rail/footer and how the surrounding empty/error/preview states feel native.

## Who uses this

Same operators as Stage 5A. 1–3 AS staff who already send Normal Email broadcasts daily. They picked HTML Email because they want images, columns, branded layout — they're not designers, they're not technical, and they should not be made to think about HTML.

## Visual harmonization

- **Reuse the wizard chrome unchanged.** Same step rail, same step header, same `WizardFooter` Continue/Back behavior as the Normal Email path. The HTML editor is **content inside the existing frame**, not a new full-screen surface.
- **Match Stage 5A compose-step rhythm.** Header, subhead, editor zone, helper text/footer. The Unlayer iframe takes the place of the Markdown editor zone — same vertical position, similar visual weight.
- **Unlayer chrome tones down.** Unlayer ships a colorful default toolbar; configure it (via Unlayer's API, not by overriding CSS) to use the platform's neutral palette: slate-900 active state, slate-100 hover, white background. Match the Markdown composer's restraint.
- **Brand-default starter.** A blank HTML draft should NOT be a blank Unlayer canvas. Seed it with: AS logo header block, single text block placeholder ("Write your message here…"), AS footer block matching the existing Stage 5A email footer (unsubscribe + branding). This is the operator's starting point every time.

## High-level operator flow (HTML Email path)

```
Step 1 (Launch type) — pick "HTML Email" (no longer grayed out)
Step 2 (Broadcast kind) — same as Stage 5A; only "project" enabled for HTML in this carve-out
Step 3 (Audience) — same as Stage 5A
Step 4 (Compose) — NEW Unlayer-host variant (this brief)
Step 5 (Review + send) — same as Stage 5A
```

Only Step 4 changes. Everything else inherits unchanged.

## Screen inventory

### Step 4 — Compose (HTML Email variant)

**Route:** `/broadcasts/new` (state-driven, same as Normal Email)

**Purpose:** operator builds the HTML email body using Unlayer's drag-and-drop editor. Subject, preheader, and sender fields surround the editor the same way they do in the Markdown variant.

**Required elements:**

- Step header — same component as Normal Email path; copy: "Compose your HTML email"
- Subject + preheader + sender fields above the editor (reuse Normal Email components verbatim)
- Unlayer editor host — iframe that takes the full content width of the wizard column, ~700px tall by default, expandable
- A small "Preview" button or tab beneath the editor that opens the existing iframe preview surface (don't build a second preview)
- Footer text: "The AS unsubscribe footer is added automatically. You don't need to add one." — small, slate-500, below the editor

**States to design:**

- **Empty / first-load** — operator just picked HTML Email and arrived at Step 4. Editor opens to the brand-default starter (AS logo + placeholder text block + AS footer). NOT a blank canvas.
- **Resume / saved draft** — operator left the wizard and came back. Editor reopens to the operator's last-saved design. Persistent loading state while the design rehydrates (typical 200-500ms).
- **Loading** — editor iframe hasn't loaded yet. Show a neutral skeleton that matches the editor's eventual footprint; do NOT show Unlayer's branded loading spinner.
- **Editor failed to load** — network issue, JS error inside iframe, Unlayer CDN unreachable. Show a calm inline error: "The editor couldn't load. Reload the page and try again — your draft is saved." with a Reload button. The Continue button MUST be disabled until the editor reloads successfully (operator cannot submit a broken draft).
- **Design too large to save** — Unlayer designs can balloon if operators paste large images inline. Define a soft limit (suggested: 500KB JSON) and show a non-blocking warning when crossed: "This design is getting large. Consider linking images instead of embedding." Hard limit (suggested: 2MB JSON) blocks submit with a clear error.
- **Operator pastes content that references a deleted variable** — if a merge variable in the design ({{firstName}} etc.) doesn't resolve, show a warning chip near the affected block.

### Step 5 — Review + send (HTML Email variant)

**Route:** same as Normal Email.

**What changes:** the body preview block shows the rendered HTML faithfully (already does — the existing iframe preview should work without modification; **spot-check this in design with a representative Unlayer HTML output**).

**What stays the same:** audience summary, schedule controls, send button, all microcopy.

### Step 1 — Launch type (small delta)

**What changes:**

- Remove the `disabled` state on the HTML Email card
- Remove the COMING SOON tag on the HTML Email card
- Update the disclaimer at the bottom: today says "Phase A ships Normal Email only. HTML Email arrives once the drag-and-drop builder lands; SMS follows." — change to "SMS arrives once carrier approval lands." (only SMS remains gated)

**What stays the same:** all card visuals, layout, copy on the cards themselves, Continue behavior.

## Microcopy guidance

- **Empty starter helper text:** "Write your message here…" (placeholder block in the brand-default starter)
- **Footer reassurance:** "The AS unsubscribe footer is added automatically. You don't need to add one."
- **Save-state indicator:** match the Normal Email path's autosave indicator (same wording, same position, same timing)
- **Design-too-large warning (soft):** "This design is getting large. Consider linking images instead of embedding."
- **Design-too-large error (hard):** "This design is too large to save. Reduce image sizes or remove blocks."
- **Editor failed to load:** "The editor couldn't load. Reload the page and try again — your draft is saved."
- **Test-send affordance copy:** "Send a test email to yourself before going live." (placement: above the Send button in Step 5; same in Normal Email path — confirm not a new addition)

## Accessibility

- Editor iframe must have a clear `<iframe title>` (Unlayer supports this via config; specify what title to use).
- All wrapping wizard chrome remains keyboard-accessible. Unlayer's editor itself is keyboard-accessible by default — verify in design pass.
- Focus management: when the editor loads, do NOT auto-focus inside the iframe (steals focus from operators using keyboard nav).
- Color contrast in Unlayer's configured toolbar palette must hit WCAG AA against the editor's white canvas.

## What to deliver

- Figma file (or design system extension) covering all states above
- A short doc enumerating Unlayer configuration values (toolbar palette, default font, default block widths, brand colors) so engineering can pass them through `react-email-editor`'s `options` prop
- A specimen email — exported from Unlayer using the proposed brand-default starter — opened in Gmail and Outlook web to confirm the rendered output looks like the operator expects
- Sign-off on the Step 5 preview spot-check (does the existing iframe preview render Unlayer HTML faithfully or does it need adjustment?)

## Reference points in the existing platform

- **Existing compose-step (Markdown variant):** `apps/web/app/broadcasts/new/_components/compose-step.tsx`
- **Existing launch-type picker:** `apps/web/app/broadcasts/new/_components/launch-type-step.tsx`
- **Stage 5A footer template** (this is what we'll auto-append to every HTML broadcast): inspect a recent broadcast send in `apps/web/app/broadcasts/actions.ts` for the `footer.html` reference
- **Design tokens:** `apps/web/app/_lib/design-tokens-v2.ts` (Claude Design v2 — same as Settings, Inbox, AI Knowledge)

## Out of scope for this design pass

- Templates library / saved-design snippets (operators start from the brand-default starter every time in this carve-out)
- HTML for `kind='newsletter'` broadcasts (only `kind='project'` in this PRD)
- A visual delta on Step 5 (Review) beyond confirming the iframe preview renders Unlayer HTML; if the existing preview needs work, flag it but do not redesign
- Any change to the Broadcasts list page or run-detail page
- Unsubscribe page (unchanged from Stage 5A)
