# Inbox Shell — Mocked vs Wired Inventory

Status of every functional area in the inbox shell as of this build.

---

## Fully Mocked (needs backend wiring)

| Area | Mock location | What the mock does |
|------|--------------|-------------------|
| **Contact list data** | `_lib/mock-data.ts` | 8 hardcoded contacts with realistic timelines |
| **Contact detail data** | `_lib/mock-data.ts` | Full timeline, project memberships, milestones |
| **List selectors** | `_lib/selectors.ts` | Maps mock records to view models, sorts by `lastInboundAt` with `lastActivityAt` fallback |
| **Composer send** | `inbox-composer.tsx` | `setTimeout` simulating 1.2s send with 80% success rate |
| **AI drafting** | `inbox-composer.tsx` | `setTimeout` inserting a canned draft after 2s |
| **Follow-up toggle** | `inbox-client-provider.tsx` | Client-side follow-up override map layered on top of projection-backed `needsFollowUp` |
| **Reminders** | `inbox-client-provider.tsx` | Client-side `Map<string, Reminder>` — no persistence |
| **Search** | `inbox-list.tsx` | Client-side string match on name, subject, snippet, project |

---

## Ready for Backend Wiring (no UI changes needed)

| Area | File | Wiring notes |
|------|------|-------------|
| **View model shapes** | `_lib/view-models.ts` | Stable interfaces — backend must produce these shapes |
| **Selector interfaces** | `_lib/selectors.ts` | Swap `getMockContacts()` → projection query |
| **Filter definitions** | `_lib/filters.ts` | 4 filters (all, unread, follow-up, unresolved) — counts from server |
| **Error boundary** | `error.tsx` | Safe FP-07 boundary — logs digest, shows retry |
| **Loading skeletons** | `inbox-loading.tsx` | Full-app and queue-only skeletons ready |
| **Empty states** | `inbox-empty-state.tsx` | "Select a person" and "All caught up" states |
| **Timeline rendering** | `inbox-timeline.tsx` | 9 entry kinds with correct visual treatment |
| **Contact rail** | `inbox-contact-rail.tsx` | Projects, milestones, contact info — driven by view model |

---

## Needs Backend (new code required)

| Area | What's needed |
|------|--------------|
| **Server actions** | `sendReply`, `saveNote`, `toggleFollowUp`, `markAsRead` returning safe error envelope |
| **Projection queries** | Read from `contactInboxProjection` + `contactTimelineProjection` |
| **Revalidation endpoint** | Protected internal route that calls `revalidateTag()` for webhook/worker triggers |
| **Polling endpoint** | Lightweight freshness check (returns last-modified timestamp or version) |
| **Real search** | Server-side search across contacts, replacing client-side string matching |
| **Auth guard** | Route-level auth check (not built per task scope — no sign-in page) |

---

## Product Behavior Preserved

- One row per person, not one row per thread
- Queue state is projection-driven, not UI-owned
- Single recency-sorted list (`lastInboundAt desc`, `lastActivityAt desc` fallback)
- Unread / Needs Follow-Up / Unresolved Review are row-level states, not list partitions
- `bucket` and `needsFollowUp` are separate fields (never collapsed)
- Unread filter uses bucket state, follow-up filter uses `needsFollowUp`, unresolved filter uses `hasUnresolved`
- Toggling follow-up does not change row ordering
- Unresolved review overlays on top of queue state
- Internal notes included in timeline and composer
- Campaign/automated sends rendered as collapsed entries
- Safe error envelope — no raw errors in UI
