# Runbook: <symptom in operator language>

**Severity:** S1 / S2 / S3
**Average time to recover:** ~N minutes
**Last verified:** YYYY-MM-DD against commit <sha>

## Symptom

What the operator sees — exact wording from the UI / email / whatever the
operator notices first. Quote it verbatim where possible.

## Likely causes (in order of probability)

1. **<cause>** — how to verify (1 command, 1 URL, or 1 UI navigation).
2. **<cause>** — how to verify.
3. **<cause>** — how to verify.

## Recovery

Step-by-step. Each step is one action with one verification check. The
operator should be able to follow this top-to-bottom without thinking.

1. Do X. Verify by checking Y.
2. If Y looks like Z, do W. Otherwise skip to step 3.
3. ...

## If recovery fails

Who to escalate to. What state to capture before escalating.

For now: alert `nico@adventurescientists.org`. Include:
- Time the symptom was first noticed.
- Output of any commands run during recovery.
- Screenshot of the relevant UI surface.

## Related

- **Code paths:** [file.ts:line](relative/path/file.ts:line) — what it does
- **Other runbooks:** [related-runbook.md](./related-runbook.md)
- **Recent incidents:** PR #N (date) — what happened, what was fixed
