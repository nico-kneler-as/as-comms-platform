# Stage 5A Email Broadcasts — UI Design Brief

**Audience:** product designer
**Companion document:** [PRD #412](https://github.com/nico-kneler-as/as-comms-platform/issues/412)
**Phase scope:** Phase A (Normal Email path) only — HTML Email and SMS are placeholders
**Last updated:** 2026-05-14
**Historical note:** Historical design brief — HTML composer (D-050) and SMS broadcasts have since shipped; see `campaigns-bundle.md`.

---

## Context

We're building the **Email Broadcasts** surface in the Adventure Scientists internal communications platform. This replaces our current Mailchimp workflow with an in-app way for staff to send one-to-many emails to volunteers and other AS contacts. The rollout is phased: we ship the basics first with the existing Markdown composer, then add a drag-and-drop HTML editor, then migrate the monthly newsletter off Mailchimp.

The platform already has a strong design language across Inbox, Composer, Settings, and AI Knowledge surfaces. Broadcasts must feel **like a native chapter of the existing app**, not a bolted-on second tool.

## Who uses this

- 1–3 internal AS staff at any time
- They already use the platform daily for one-to-one volunteer communication via the Inbox
- Currently context-switch into Mailchimp once a month for the newsletter and ad-hoc for project recruitment emails — that's the pain point we're fixing
- Comfortable with software but not technical; design should feel as friction-free as Mailchimp's, not as developer-friendly as SendGrid's

## Visual harmonization — match the existing design language

- **Don't reinvent the chrome.** Use the existing nav, page layout, and design tokens (Claude Design v2 — same palette, spacing, type scale, button styles, card patterns as Inbox and Settings).
- Match the **Inbox list row aesthetic** for the Broadcasts list page (avatar/icon, primary text, secondary text, status chip on the right, hover state, click-to-detail).
- Match the **Settings page rhythm** for any settings surfaces we add (single-page sections stacked with section headers, not a sidebar).
- Match the **Composer inline draft pane** for the broadcast compose surface — operators already know how to write emails in the platform; this should feel like an extension of that.
- Match the **Project filter chip / dropdown** from Inbox for the audience builder filters.
- Match the **frozen review state** pattern from Inbox's read-only message view (clearly non-editable, but legible and inspectable).

## High-level operator flow

```
Broadcasts list → Create new broadcast → Pick launch type → Pick broadcast kind
   → Build audience → Compose + preview → Review (frozen) → Schedule or send now
   → Run detail (live counters during send) → Run history view
```

Recipients receive the email and may click an unsubscribe link, which takes them to a public-facing unsubscribe page (not part of the operator app).

## Screen inventory

### 1. Broadcasts list page

**Route:** `/broadcasts`

**Purpose:** the home page of the Broadcasts surface. Shows all broadcasts the team has run plus all historical Mailchimp campaigns we've ingested, in identical row shape.

**Required elements:**

- A primary "New broadcast" call-to-action at the top
- A list of broadcasts sorted by most recent activity, with each row showing:
  - Broadcast name
  - Sender alias (e.g., `forests@adventurescientists.org`)
  - Kind chip (Newsletter / Project email)
  - State chip (Draft / Scheduled / Sending / Complete / Cancelled / Finalized)
  - Sent count / total audience (e.g., "1,247 / 1,250 sent")
  - Provider badge — small, unobtrusive ("Postmark" or "Mailchimp"); only for forensic clarity
  - Sent date (or scheduled date if upcoming)
- A project filter chip (multi-select), matching the existing Inbox project filter behavior
- A search field for searching by broadcast name
- Empty state: "No broadcasts yet" with the New Broadcast CTA front-and-center

**States to design:**

- Empty (first-time use)
- A few rows (3-10 broadcasts)
- Many rows (filtering and pagination behavior)
- Filtered to no results

### 2. Create broadcast — Step 1: Launch type

**Purpose:** the first decision when starting a new broadcast.

Three large card-like buttons or tiles:

- **Normal Email** — "Quick to write, plain or lightly formatted. Best for project updates, calls to action, short messages." [Available now]
- **HTML Email** — "Drag-and-drop newsletter-quality emails with images and rich layout. Best for newsletters and announcements." [Coming soon — grayed out / disabled]
- **SMS** — "Short text messages sent to volunteers' phones." [Coming soon — grayed out / disabled]

**Important:** the two "Coming soon" tiles must be visible from day 1 — they signal to operators that more is coming and shape the mental model. They should not be hidden.

### 3. Create broadcast — Step 2: Broadcast kind

**Purpose:** affects unsubscribe footer wording and audience-builder defaults.

Two options:

- **Newsletter** — "The monthly AS newsletter. One audience: everyone subscribed."
- **Project email** — "A targeted message for a specific project's volunteers (e.g., Beech Leaf Disease, Forests, Killer Whales)."

(In Phase A, the Newsletter path is functional but mostly used after Phase C migration. The Project email path is the primary Phase A use.)

### 4. Create broadcast — Step 3: Audience builder

**Purpose:** the operator builds a filtered list of recipients from our canonical contact database.

**Filter options (multi-select where applicable):**

- **Project** — checkbox list of active projects. Connected sub-projects appear as equal-rank options (e.g., "Beech Leaf Disease" and "Butternut Canker" appear as separate checkable items, with a small visual hint that they share the `forests@` alias).
- **Expedition-member status** — checkbox list using real Salesforce picklist values: "In the Field", "In Training", "Active", "Inactive", "Withdrawn" (final values come from a one-time SF inspection; designer should treat the list as ~5-7 chips).
- **Expedition** — multi-select dropdown of recent expeditions
- **Last activity** — date range or relative picker ("Active in the last 30 days", "Last 90 days", "Last year", "All time")
- **Has replied** — yes/no/either
- **Has clicked a prior broadcast** — yes/no/either

**Live recipient count** updates as filters change. Prominent display ("**1,247** recipients match").

**Above 5,000 recipients:** show a soft warning banner: "This is a large send. Please double-check the filters before continuing." Operator can proceed with one extra confirmation.

**Below the count:** an expandable "Preview audience" section that lists the first 20-50 recipients with their name + email + project, so the operator can sanity-check.

### 5. Create broadcast — Step 4: Compose + preview

**Purpose:** the operator writes the email content.

**Left pane — composition (reuse Composer's existing Markdown editor surface):**

- Subject line input at the top
- Markdown editor body (operators already know how to use this from one-to-one Composer)
- Toolbar for inserting merge tokens: `{{firstName}}`, `{{projectName}}`, `{{aliasEmail}}` — clickable chips that insert at cursor position
- An auto-saved indicator ("Saved 12 seconds ago") that updates every ~30 seconds

**Right pane — live preview:**

- Renders the email as the recipient will see it, including merge tokens resolved for a sample contact
- A "Sample contact" picker at the top — defaults to first contact in audience, dropdown lets operator pick any specific recipient or use Previous / Next arrows to rotate through
- Shows the full footer with the rendered unsubscribe scope (e.g., "Unsubscribe from Forests emails ∙ Unsubscribe from all Adventure Scientists emails")
- Links should be clickable for spot-checking (they open in new tabs)

**Test send button:**

- Default target: the logged-in operator's email address
- Configurable to send to any address (text input next to the button)
- Emails sent this way are flagged internally as test sends and never count toward broadcast metrics

**Validation surface:** if any merge tokens fail to resolve for any audience contact, a yellow warning surfaces above the editor: "5 contacts will get a blank firstName. [Review affected contacts] | [Proceed anyway]"

### 6. Create broadcast — Step 5: Review + send

**Purpose:** the explicit, irreversible-after-confirmation moment.

A single full-page review that shows:

- Broadcast name (editable inline)
- Kind chip (Newsletter / Project)
- Sender — dropdown of verified project aliases; default to the alias suggested by the audience composition (e.g., audience is single-project Beech → suggests `forests@`)
- **Reply-to is fixed to match the sender** — display only, with a small explainer ("Replies go to the same address")
- Audience size + a "Re-run audience" link to bounce back to Step 3 if needed
- Rendered email preview (collapsed by default; expandable)
- Schedule picker:
  - "Send now"
  - "Schedule for later" — date/time picker in America/Denver timezone (the org's locked timezone)
- Final confirmation: a big button labeled either "Send now" or "Schedule send", with one modal confirmation dialog that summarizes ("Send 1,247 emails from forests@ right now?")

**Frozen state styling:** Once confirmed, the entire page transitions to a frozen / read-only style — all inputs become non-editable, with a banner explaining: "This broadcast is scheduled for X — content and audience are locked. To edit, cancel and start a new draft."

### 7. Run detail page

**Route:** `/broadcasts/[runId]`

**Purpose:** the broadcast's "passport" — at-a-glance state plus drill-down.

**Top section — header:**

- Broadcast name (large, bold)
- State chip prominently (Draft / Scheduled / Sending / Complete / Cancelled / Finalized)
- Sender alias
- Kind chip
- Sent / scheduled date
- For in-flight or upcoming broadcasts: a **Cancel** button
- A "Duplicate this broadcast" action that creates a new draft with the same content + criteria

**Middle section — metric tiles (live-updating during send):**

- Queued, Sent, Delivered, Bounced, Opened, Clicked, Unsubscribed, Complained
- Each tile shows the count + a small percentage of total audience
- Tiles for early states ("Queued") gracefully replace with later-state values as the run progresses

**Below tiles — recipients table:**

- Searchable list of audience contacts
- Per-row: name, email, frozen project, delivery state (Sent / Delivered / Opened / Clicked / Bounced / Unsubscribed / Complained), timestamp of latest event
- Click a row → opens that contact's full Inbox detail in a new tab

**Side rail:**

- A "Replies in Inbox →" panel showing reply count + recent replies, with click-through to Inbox
- Broadcast audit log: who created, scheduled, cancelled (timestamped)
- Audience criteria snapshot (the filters used, displayed for forensic reference)

**Cancel-while-running confirmation modal:**

- Title: "Cancel this broadcast?"
- Body: "We'll stop sending to remaining recipients. **Already-sent emails cannot be recalled.** 643 of 1,247 emails have been sent so far."
- Buttons: "Cancel broadcast" (destructive red) | "Keep sending" (default)

### 8. Public unsubscribe page

**Route:** `/u/[token]` — accessible without login, by anyone with the personalized link from a broadcast footer

**Purpose:** recipient-facing one-click opt-out.

**On landing (default scope = the broadcast's scope):**

- AS logo at the top
- Plain text headline: "You've been unsubscribed from Forests emails."
- One line of body: "You won't receive broadcast emails from this project anymore."
- A secondary action below: "Want to unsubscribe from **all** Adventure Scientists emails instead?" → clicking confirms a broader opt-out
- Footer with our physical address + a "Did this happen by mistake? Contact us" link

**Important:** the unsubscribe should already have happened by the time the page loads. No "Click here to confirm" step — that defeats one-click compliance with Gmail's bulk-sender rules.

**Variants:**

- For newsletter unsubscribes: "You've been unsubscribed from the AS newsletter."
- For "Unsubscribe from all": "You've been unsubscribed from all Adventure Scientists emails."

### 9. Settings additions

**New section: Postmark sender verification (inside the Project detail page, under each alias)**

- Status pill per alias: "Verified" (green) / "Pending verification" (yellow) / "Not verified" (gray) / "Failed verification" (red)
- For non-verified states: an expandable "Setup" section showing the DKIM CNAMEs and Return-Path subdomain CNAMEs that IT needs to add to DNS
- A "Re-check now" button

**New section: Organization settings → Physical address**

- A simple form with street, city, state, zip — used for the legal footer on every broadcast email
- One section, one save button; edit-in-place pattern

### 10. The email itself (the footer template)

**Footer chrome on every broadcast email** (operator can't accidentally delete this):

- AS logo (small, top of footer)
- Physical mailing address (pulled from Organization settings)
- "You're receiving this because you're a volunteer with the [Project Name] project at Adventure Scientists."
- For project emails: "Unsubscribe from [Project Name] emails ∙ Unsubscribe from all Adventure Scientists emails"
- For newsletter: "Unsubscribe from the AS newsletter ∙ Unsubscribe from all Adventure Scientists emails"

## States to design for every screen

For each of the screens above, the designer should produce:

- **Default / filled** state
- **Empty / first-use** state
- **Loading** state (skeleton or spinner — match existing platform patterns)
- **Error** state — what does the operator see if Postmark is down, or a draft fails to save, or the page can't load? Use the existing safe error envelope pattern (a friendly message + retry action).

For the create flow and run detail page, additionally:

- **Editable state** (draft)
- **Frozen / read-only state** (scheduled and beyond)
- **In-flight live-updating state** (sending)
- **Finalized historical state** (post-30-day tail)

## Microcopy guidance for tricky moments

- Cancel-while-running confirmation: emphasize that already-sent emails cannot be recalled.
- 5,000+ recipient soft warning: warm tone, not scolding ("This is a large send — please double-check before continuing").
- Frozen state banner: explain that editing requires canceling and creating a new draft.
- Public unsubscribe page: warm and reassuring, not defensive ("You've been unsubscribed" — not "Unsubscribe request received").
- Missing merge tokens warning: surface the actual contacts affected ("Review affected contacts") not just a count.

## Accessibility

- All metric tiles on run detail need accessible labels for screen readers (e.g., "Sent: 1,247 of 1,250, 99.8%").
- The audience builder's live count must announce updates politely (aria-live polite, not assertive).
- The launch-type picker tiles must be operable by keyboard; disabled tiles ("Coming soon") must announce as disabled.
- Color shouldn't be the only signal for state chips (use a label + color, not color alone).
- The public unsubscribe page must work without JavaScript (server-renders the "you've been unsubscribed" message).

## Out of scope for this design pass

To keep the scope honest:

- SMS launch type (placeholder only)
- HTML Email drag-and-drop editor (placeholder only in this pass; Phase B will need its own design pass once we're ready)
- Recurring or drip-series broadcasts (single-shot only)
- A/B testing UI
- Saved/named audiences reusable across broadcasts
- Conditional content blocks in merge tokens
- In-app notifications / "request review" workflow between operators

## Phasing reminder

This design pass is for **Phase A** (Normal Email path, project-specific sends). HTML Email and SMS appear in the launch-type picker as "Coming soon" placeholders. **Don't design the HTML Email composer in detail** — that's Phase B and will get a dedicated design pass once we're closer to building it. Same for SMS.

## What to deliver

- Figma file with the screens above, organized by flow
- Light and dark variants if the platform supports both (it does — match existing theming)
- One short Loom or written walkthrough of the operator flow from start to send (helps engineering review the design)
- Component reuse callouts where you're leveraging existing patterns (filter chips, frozen review state, etc.)

## Reference points in the existing platform

- **Inbox list page** — match the row aesthetic for the Broadcasts list
- **Inbox contact detail + timeline** — match the rhythm for the Run detail page
- **Composer inline draft pane** — reuse the Markdown editor surface for compose
- **Settings → Projects** — match the section pattern for adding the Postmark verification section
- **AI Knowledge activation wizard** — match the multi-step flow shape for the Create Broadcast wizard
- **Project filter dropdown in Inbox** — reuse for the audience builder's project filter
