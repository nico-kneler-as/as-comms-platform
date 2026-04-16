# Inbox Shell — Status

## Wired in this pass

- Real Stage 1-backed inbox list reads.
- Real Stage 1-backed selected-contact detail reads.
- Real server-backed `needsFollowUp` persistence.
- Mainline route shape preserved:
  - `/inbox`
  - `/inbox/[contactId]`
- Mainline shell architecture preserved:
  - `app/inbox/layout.tsx`
  - `app/inbox/_components/*`
  - `app/inbox/_lib/*`

## Still Mocked or Prototype

- Composer send remains prototype/local.
- Internal note creation remains prototype/local.
- Reminder state remains client-only.
- Search remains client-side string matching over the rendered list items.

## Backend Notes

- The list and detail selectors now run against real Stage 1 repository reads
  and use `unstable_cache` with inbox/timeline tags.
- Follow-up persistence writes back to the existing inbox projection field
  mapped from the persistence boundary field `is_starred`.
- The physical DB naming is unchanged.

## Known Follow-Ups

- Large real inbox payloads can still trigger `unstable_cache` size warnings.
- Identity review detail still relies on selector-side contact matching where a
  case is anchored by contact ID or references the contact in candidate IDs.
- The current data model still does not provide:
  - a canonical persisted CRM URL for project memberships
  - a dedicated unread-count field for the list badge
  - a canonical persisted membership season/year for the contact rail
