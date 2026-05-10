# Runbook: AI Knowledge sync failed or stuck

**Severity:** S2
**Average time to recover:** ~5 minutes
**Last verified:** 2026-05-02 against commit 2e1bca13

## Symptom

The operator is on **Settings → Project → AI Knowledge** and sees one of:

- A red toast after clicking **Re-sync all** or the per-row sync icon (e.g.
  `"AI knowledge synthesis failed for <projectId>."` or
  `"<projectId> has no healthy AI knowledge sources to synthesize."`).
- A source row stuck on `broken` status with a rose error message inline.
- The "Synthesizing now…" spinner showing for more than 3 minutes (typical
  run is 30–90s; the Anthropic call is bounded to 180s).
- The amber `"Synthesis is stale…"` banner persists after a re-sync.

AI **drafting** failures (the Composer's "Draft with AI" button) are a
different surface — see [ai-draft-failed-or-malformed.md](./ai-draft-failed-or-malformed.md).

## Likely causes (in order of probability)

1. **A source is no longer reachable** — most common. Notion page was
   un-shared from the AS Comms integration, page was deleted, or a web URL
   returned 4xx/5xx. Verify: the row's Status column shows `broken` with
   an inline error message.

2. **No healthy sources to synthesize** — synthesis returns
   `no_healthy_sources` if every enabled source is `broken` or `stale`.
   Verify: toast says `… has no healthy AI knowledge sources to synthesize.`

3. **Anthropic call timed out or rate-limited** — synthesis hit the 180s
   timeout or a 429. Verify: Railway `worker` logs show `synthesis failed`
   with `code: "llm_failed"`.

4. **Worker queue is stuck** — job enqueued but never ran. Verify: spinner
   shown >5 minutes AND no recent `synthesize-project-knowledge` line in
   Railway `worker` logs. Switch to [worker-queue-stuck.md](./worker-queue-stuck.md).

## Recovery

1. **A single source is `broken`:** click the row's refresh icon to
   re-sync just that source. For Notion, open the URL and confirm the AS
   Comms integration is in **Share → Connections**; if not, re-share, then
   re-sync. For web pages, open the URL in a browser; if it 404s or 5xxs,
   alert the architect — the source may need to be replaced or removed.

2. **Toast says `no healthy sources`:** at least one source must be
   `healthy` (green) for synthesis to run. Fix step 1 for each `broken`
   row, or temporarily disable broken rows. Then click **Re-sync all**.

3. **Spinner stuck >5 minutes:** open Railway → `worker` → **Logs**.
   Search for `synthesize-project-knowledge`. If you see a recent
   `code: "llm_failed"` with an Anthropic 429 or timeout, wait 2 minutes
   and click **Re-sync all** again. If you see no recent log line for the
   job at all, follow [worker-queue-stuck.md](./worker-queue-stuck.md).

4. **Amber stale banner persists after re-sync, or AI drafts feel out of
   date:** trivially edit a source's label or URL and click **Re-sync all**
   — that bypasses the skip-if-unchanged guard. If still stale, alert the
   architect to run `pnpm ops:synthesize-project-knowledge` on the worker.

## If recovery fails

Alert `nico@adventurescientists.org`. Include:
- Project ID (from URL: `/settings/projects/<projectId>`).
- Exact toast text and any per-source error messages (screenshot).
- Time of first failure; how many times **Re-sync all** was clicked.

The platform's AI drafting still works without a fresh synthesis — the
last good content remains the active draft context. Operators can keep
working while diagnosis happens.

## Related

- **Code paths:**
  - [`apps/worker/src/jobs/synthesize-project-knowledge/orchestrator.ts:380`](../../apps/worker/src/jobs/synthesize-project-knowledge/orchestrator.ts) — orchestrator; returns `project_missing` / `no_healthy_sources` / `llm_failed`
  - [`apps/worker/src/jobs/synthesize-project-knowledge/orchestrator.ts:30`](../../apps/worker/src/jobs/synthesize-project-knowledge/orchestrator.ts) — `DEFAULT_SYNTHESIS_TIMEOUT_MS` (180s, raised in PR #387)
  - [`apps/web/app/settings/_components/project-ai-knowledge-section.tsx:155`](../../apps/web/app/settings/_components/project-ai-knowledge-section.tsx) — Settings UI, banner copy, polling cadence
  - [`apps/worker/src/runtime.ts:142`](../../apps/worker/src/runtime.ts) — hourly cron `pollAiKnowledgeAutoSyncJob` re-triggers daily/weekly auto-sync
  - [`apps/worker/package.json:36`](../../apps/worker/package.json) — `ops:synthesize-project-knowledge` manual trigger
- **Other runbooks:** [ai-draft-failed-or-malformed.md](./ai-draft-failed-or-malformed.md), [worker-queue-stuck.md](./worker-queue-stuck.md), [morning-ops-checks.md](./morning-ops-checks.md)
- **Recent incidents:**
  - PR #387 (2026-05-01) — bumped Anthropic timeout to 180s after synthesis hit the previous 60s cap on large corpora.
  - PR #382 (2026-05-01) — surfaced actionable Notion access errors inline; before this, broken-Notion errors said only "fetch failed."
