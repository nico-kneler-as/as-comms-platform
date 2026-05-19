# Operational Runbooks

Source of truth for AS Comms Platform operational procedures.
Audience: operators (1–3 people). No assumed knowledge of the codebase internals.

Each runbook targets a specific failure symptom an operator can observe directly.
Total target: ≤ 300 words per runbook.

Mirror to Notion manually after reviewing here. Do not edit Notion directly —
edit the markdown here and re-mirror.

---

## Daily

| Runbook | When to use |
|---|---|
| [morning-ops-checks.md](./morning-ops-checks.md) | Every morning before inbox triage — 60-second health glance |

## Capture failures

| Runbook | Symptom |
|---|---|
| [gmail-capture-stopped.md](./gmail-capture-stopped.md) | Inbox feels stale; alert email with `gmail integration degraded` |
| [salesforce-capture-stopped.md](./salesforce-capture-stopped.md) | Contact data stale; alert email with `salesforce integration degraded` |

## Sending failures

| Runbook | Symptom |
|---|---|
| [composer-send-failed.md](./composer-send-failed.md) | Operator clicked Send and got an error or no confirmation |

## AI

| Runbook | Symptom |
|---|---|
| [ai-draft-failed-or-malformed.md](./ai-draft-failed-or-malformed.md) | AI Draft button fails, returns blank, or returns nonsense |
| [ai-knowledge-sync-failed.md](./ai-knowledge-sync-failed.md) | Settings → AI Knowledge re-sync errors, a source is `broken`, spinner stuck, or stale banner persists |

## Worker / infrastructure

| Runbook | Symptom |
|---|---|
| [worker-queue-stuck.md](./worker-queue-stuck.md) | Worker is running but jobs not advancing; no `reconcile.completed` logs |
| [mailchimp-decommission.md](./mailchimp-decommission.md) | Planned Postmark cutover is complete (Stage 5C per `D-046`; was "Stage 5A Phase C" pre-2026-05-19 restructure) and the temporary Mailchimp ingest path must be retired |

## Investigation guides

| Runbook | When to use |
|---|---|
| [operator-reports-missing-email.md](./operator-reports-missing-email.md) | Volunteer says they sent an email that the operator cannot find |

---

## Template

Use [_template.md](./_template.md) when adding a new runbook.

## Escalation

If any runbook's recovery steps fail: alert `nico@adventurescientists.org`.
Include: symptom, steps already tried, exact error text or log lines, time first noticed.
