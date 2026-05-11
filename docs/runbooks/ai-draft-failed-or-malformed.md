# Runbook: AI draft failed or returned nonsense

**Severity:** S2
**Average time to recover:** ~5 minutes
**Last verified:** 2026-05-02 against commit ac85d7b

## Symptom

The operator clicked **Draft with AI** and the composer showed an error, a
blank draft, or a draft that is clearly wrong (wrong contact name, unrelated
content, placeholder text). The UI may display a warning banner such as
`"The projected AI draft spend is over the $20.00 daily soft cap."` or
`"AI drafting failed."` The composer falls back to a deterministic template
when the AI fails — a fallback draft is functional but generic.

## Likely causes (in order of probability)

1. **`ANTHROPIC_API_KEY` not set on the web service** — the Anthropic client
   is not configured. The AI surface falls back immediately with
   `provider_not_configured`. Verify: Railway → `web` service → Environment
   → confirm `ANTHROPIC_API_KEY` is present.

2. **Daily cost cap reached** — the in-process soft cap (`AI_DAILY_CAP_USD`,
   default $20) was exceeded. The AI still generates a draft but appends a
   `budget_warn` warning. This is not a hard block — drafts still work.
   Verify: warning banner in the Composer UI mentions "daily soft cap."

3. **Anthropic rate limit** — the Anthropic API returned 429. Usually
   self-resolves within a minute. Verify: Railway `web` logs for
   `provider_rate_limited` code.

4. **Anthropic API unavailable** — temporary outage. Verify: check
   `https://status.anthropic.com`. Verify: Railway `web` logs for
   `provider_unavailable` code.

5. **Grounding is empty** — the contact has no prior thread context or
   knowledge base entries; the AI generates a draft with minimal grounding.
   Not an error — the result will be generic. Verify: Composer warning shows
   `grounding_empty`.

## Recovery

1. **If `provider_not_configured`:** Contact the architect to add
   `ANTHROPIC_API_KEY` to the Railway `web` service environment. This
   requires a Railway deploy restart.

2. **If `budget_warn`:** No immediate action needed — drafts still generate.
   The cap resets at midnight UTC (the cost counter is in-process and
   resets on day boundary). If the cap is too low for your volume, contact
   the architect to raise `AI_DAILY_CAP_USD`.

3. **If `provider_rate_limited` or `provider_unavailable`:** Wait 1–2
   minutes and retry the draft. If repeated failures persist for more than
   10 minutes, note the time and alert the architect.

4. **If the draft is malformed but generated:** Do not send it. Discard and
   write manually. The validation layer (`apps/web/src/server/ai/validator.ts`)
   strips contradictions, but it cannot catch all hallucinations. The operator
   is always the final reviewer.

5. **If AI is broadly misbehaving across all contacts:** Contact the architect
   to evaluate disabling `ANTHROPIC_API_KEY` on the `web` service temporarily.
   The composer works fully without AI — only the Draft button is affected.

## If recovery fails

Alert `nico@adventurescientists.org`. Include:
- The `providerStatus` value shown in the Composer (check browser devtools
  network tab → the `/ai/draft` response JSON if the UI doesn't surface it).
- Time of first failure.
- Whether multiple operators are affected or just one.

## Related

- **Code paths:**
  - [`apps/web/src/server/ai/provider.ts:12`](../../apps/web/src/server/ai/provider.ts) — reads `ANTHROPIC_API_KEY`, `AI_DAILY_CAP_USD` (default $20), `ANTHROPIC_MODEL`
  - [`apps/web/src/server/ai/cost-counter.ts:35`](../../apps/web/src/server/ai/cost-counter.ts) — in-process daily cost state; resets at midnight UTC
  - [`apps/web/src/server/ai/types.ts:12`](../../apps/web/src/server/ai/types.ts) — warning codes: `provider_not_configured`, `provider_timeout`, `provider_rate_limited`, `provider_unavailable`, `budget_warn`, `grounding_empty`
  - [`apps/web/src/server/ai/draft-generator.ts:279`](../../apps/web/src/server/ai/draft-generator.ts) — error classification and fallback dispatch
- **Other runbooks:** [morning-ops-checks.md](./morning-ops-checks.md), [ai-knowledge-sync-failed.md](./ai-knowledge-sync-failed.md)
