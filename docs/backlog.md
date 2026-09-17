# Backlog

**Role:** durable, lightweight list of known follow-up items that aren't actively scoped for work
**Audience:** architect and implementers
**When to read:** when planning the next scope of work, or before opening a new issue (check this first)
**Authority:** non-blocking; items here are candidates, not commitments

## How to use

- One entry per item, kept short. The point is durability, not detail.
- An item becomes a GitHub issue (or `/to-prd` PRD) when it's actually being scoped for work. At that point, add the issue link to the entry; do not delete the entry until the work is merged.
- If you create a `/to-prd` issue for something, you can ALSO list it here with a link, but only if there's value in keeping a doc-canon-resident pointer (e.g., the work touches a load-bearing seam future readers will hit).
- Entries are grouped by area, not priority. Use the **Status** column to mark `open`, `tracked`, or `done`.

## Entry template

```
### YYYY-MM-DD — Short title

- **Status:** open | tracked (#NNN) | done (#NNN)
- **Area:** worker | web | domain | docs | data-hygiene | ...
- **Why it's here:** one sentence on what we noticed and what's wrong/missing
- **Suggested scope:** one or two sentences on what fixing it would entail; do not over-scope
- **Discovered in:** session date + ops context (so future readers know where to look for warm context)
```

## Items

### 2026-05-21 — Clear canonical_event_ledger.review_state when resolving routing/identity queue cases

- **Status:** open
- **Area:** worker / domain
- **Why it's here:** When a routing-review or identity-review case is marked `resolved`, the underlying canonical_event_ledger rows keep their `review_state` set to `needs_routing_review` / `needs_identity_review`. The convention has been intentional since the reconciler shipped — `markRoutingCaseResolved` only updates the queue table — but it leaves a permanent inconsistency between case status and event state. Currently 25+ historical canonical events have non-clear review_state with already-resolved cases.
- **Suggested scope:** (1) Update `markRoutingCaseResolved` (and the identity-queue equivalent) to also clear the matching canonical_event_ledger.review_state in the same transaction. (2) One-time backfill pass over the existing inconsistent rows. (3) Audit consumers of `canonical_event_ledger.review_state` first — there may be analytics or audit-trail uses that rely on the historical marker, in which case introduce a separate "review_history" signal before clearing.
- **Discovered in:** 2026-05-21 ops session, follow-up to manually resolving the 4 open `routing_context_conflict` cases for Matt Enos + Erasme Uyizeye. Related PRs: #455 (rebuild inbox projection after merge), #456 (auto-merge email-only into SF anchor).

### 2026-09-17 — `restart-prd/` donor links in `03-reference/*` point at a package that is not in this repo

- **Status:** open
- **Area:** docs
- **Why it's here:** Five reference docs link to `../../restart-prd/…` (`donor-map.md`, `env-and-secrets-matrix.md`, `quality-gates.md`, `salesforce-mapping-reference.md`, and the directory itself). That path does not exist in the checkout, so every "deeper donor evidence" pointer in the authority chain from `00-index.md` is dead. Agents following the documented escalation path hit nothing.
- **Suggested scope:** Decide whether the donor package still exists anywhere worth pointing at. If it does, vendor the four referenced files into `03-reference/` or link to wherever it lives; if it does not, delete the pointers and drop level 3 from the authority order in `00-index.md` so the chain stops claiming a tier it cannot serve.
- **Discovered in:** 2026-09-17 canon audit (broken-relative-link sweep over `docs/**/*.md`).

### 2026-09-17 — `.codex-exec.log` is tracked in the repo

- **Status:** open
- **Area:** repo hygiene
- **Why it's here:** A 349 KB Codex execution transcript is committed at the repo root. Every other `.codex-*` dispatch log is untracked scratch; this one appears to have been added by accident and no doc or script references it.
- **Suggested scope:** Confirm nothing reads it, `git rm` it, and add the `.codex-*log` shape to `.gitignore` so the next one does not land the same way. One-line change; not worth a PR of its own — fold into the next docs or chore PR.
- **Discovered in:** 2026-09-17 workspace cleanup (spotted when a delete of untracked artifacts showed it as a tracked deletion).

### 2026-09-17 — AI Draft is pinned to Claude Sonnet 4.x

- **Status:** open
- **Area:** web / domain
- **Why it's here:** The provider adapter and prompt path reference `claude-sonnet-4-0`, `claude-sonnet-4-20250514` and `claude-sonnet-4-6` across `apps/web/src/server/ai` and `packages/integrations`. Newer Claude models have shipped since those were pinned. This is not a defect — drafts work — but model choice is load-bearing for draft quality, and `D-061` just spent a PR making voice rules bind at the prompt level, which a stronger model may do better unaided.
- **Suggested scope:** Check current model availability and pricing against `D-032`'s cost envelope (soft $20/day cap), try the current Sonnet or Opus tier against the existing draft corpus, and either re-pin or record why the current pin stays. Three separate model-id literals should collapse to one constant while doing it.
- **Discovered in:** 2026-09-17 canon audit, while verifying that `reference-services.md`'s "OpenAI" row was stale.
