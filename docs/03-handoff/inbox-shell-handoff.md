# Inbox Shell — Real Wiring Handoff

This handoff reflects the current mainline Inbox shell under
`apps/web/app/inbox/`. The shell architecture is unchanged: the persistent list
chrome still lives in `layout.tsx`, `/inbox` still renders the empty-state page
inside that shell, and `/inbox/[contactId]` still renders the selected-contact
detail page.

## What Is Real Now

- `apps/web/app/inbox/_lib/selectors.ts`
  - `getInboxList(filterId?)` now reads real Stage 1 data from
    `contact_inbox_projection`, `contacts`, `contact_memberships`,
    `project_dimensions`, `canonical_event_ledger`, `gmail_message_details`,
    and `contact_timeline_projection`.
  - `getInboxDetail(contactId)` now reads real Stage 1 data from
    `contacts`, `contact_inbox_projection`, `contact_memberships`,
    `project_dimensions`, `canonical_event_ledger`,
    `gmail_message_details`, and `contact_timeline_projection`.
- `apps/web/app/inbox/actions.ts`
  - `markInboxNeedsFollowUpAction` and `clearInboxNeedsFollowUpAction` now
    persist through the server by updating the inbox projection row for the
    selected contact.
- `apps/web/src/server/stage1-runtime.ts`
  - Small server-only runtime for `DATABASE_URL`, Stage 1 repositories, and
    test overrides.
- `apps/web/src/server/inbox/follow-up.ts`
  - Narrow server helper that updates only `needsFollowUp` and leaves bucket,
    unresolved state, timestamps, snippet, and last-event fields untouched.

## Preserved Contract

- One row per person, not one row per thread.
- Single mixed contact list.
- Default ordering remains `lastInboundAt desc`, with `lastActivityAt desc`
  fallback when `lastInboundAt` is missing.
- Unread remains bucket-driven.
- `needsFollowUp` remains a separate explicit flag.
- `hasUnresolved` remains an overlay.
- Follow-up toggling does not reorder rows.
- Route structure remains `/inbox` and `/inbox/[contactId]`.

## Current Bridging Logic

- `unreadCount` is still a selector-derived `1/0` badge keyed from bucket state,
  because the current projection model does not store a per-contact unread
  message count.
- Membership `year` is still selector-derived from the current UTC year,
  because the canonical membership season/year is not persisted on the current
  Stage 1 read model.
- `crmUrl` in the contact rail is still synthesized from `projectId`, because a
  canonical persisted CRM URL is not available on the membership dimension yet.
- Timeline bodies and subjects are exact for Gmail-backed email events. When a
  richer provider-specific communication detail is not available, the selector
  falls back to timeline summaries so the shell contract stays stable.

## Revalidation

- `inbox`
- `inbox:contact:{contactId}`
- `timeline:contact:{contactId}`

The follow-up actions revalidate those tags after a successful update so the
mainline shell refreshes from server state instead of client-side overrides.
