# Reference Legacy Conflicts

**Role:** compact lookup for high-value conflicts between restart canon and legacy donor material  
**Audience:** implementers who encounter contradictory old notes or donor behavior  
**When to read:** only when a legacy source appears to disagree with the agent-first canon  
**Authority:** reference-only; `restart-agent-focus` core docs still win

## Known High-Value Conflicts

| Legacy pattern | Current restart truth |
| --- | --- |
| manual Notion sync/review/confirm workflow | background sync/cache with no approval gate |
| donor repo as implementation baseline | fresh rebuild in a new repo |
| benchmark-era UI decisions as product truth | only re-locked decisions in the current canon matter |
| older Inbox `New / Open / Closed` or queue-tab-first workflows | one mixed contact list, bucket-derived unread, explicit `needsFollowUp`, unresolved overlay, no first-release close/reopen dependency |
| flexible framework/stack choice during implementation | locked Next.js / React / TS / Postgres / worker stack and repo shape |

## When You Hit A Conflict

1. prefer `restart-agent-focus/01-core/*`
2. if needed, confirm in [`../01-core/decision-log.md`](../01-core/decision-log.md)
3. do not import the legacy behavior unless the canon is updated first

## Deep Reference

- repo-local decision history: [`../01-core/decision-log.md`](../01-core/decision-log.md)
