# Stage 5A Phase C — Newsletter Audience Audit Playbook

**Role:** the executable audit that Brief C0 produces a written report against  
**Audience:** the architect (operator with SF + Mailchimp + Railway Postgres access)  
**When to read:** when ready to plan Phase C newsletter migration (any time post-D-045)  
**Authority:** implementation-spec layer; pairs with [stage-5a-campaigns.md](./stage-5a-campaigns.md)  
**Decides:** what we know about the newsletter audience before migration  
**Does not decide:** the actual migration approach (that's Brief C1, informed by this audit)

## Goal

Before Phase C migrates the AS newsletter off Mailchimp, answer four questions:

1. **What is the real "newsletter-subscribed" audience in Salesforce?** (`Subscribed_to_Org_Newsletter__c = TRUE AND HasOptedOutOfEmail = FALSE`)
2. **What fraction of the Mailchimp newsletter audience is volunteer-anchored vs. donor/partner/external?** (`Expedition_Members__c` linkage)
3. **Where do the SF and Mailchimp audiences disagree?** (people in Mailchimp not in SF, opted-out-in-SF still in Mailchimp, etc.)
4. **Is there a clean SF-anchored audience for Phase C, or do we need a one-time donor import first?**

Output: a short written summary stored next to this doc (e.g., `stage-5a-phase-c-audit-results-2026-MM-DD.md`).

## Prerequisites

- SF admin access — can run SOQL via Workbench, Developer Console, or `sf data query`
- Mailchimp admin access — can export the Newsletter audience CSV
- Railway Postgres read access (the `DATABASE_PUBLIC_URL` via `hopper.proxy.rlwy.net`) — for reconciliation joins
- ~30 min of focused time

## Step 1 — Verify the SF fields exist

The audit assumes two fields exist on the Salesforce Contact object:

- `Subscribed_to_Org_Newsletter__c` (custom Boolean)
- `HasOptedOutOfEmail` (standard SF field)

Smoke test by running these in Workbench:

```sql
SELECT Id FROM Contact WHERE Subscribed_to_Org_Newsletter__c = TRUE LIMIT 1
SELECT Id FROM Contact WHERE HasOptedOutOfEmail = TRUE LIMIT 1
```

If either errors with "No such column," confirm the actual field name via:

```sql
SELECT QualifiedApiName, Label FROM FieldDefinition 
WHERE EntityDefinitionId = 'Contact' 
  AND (QualifiedApiName LIKE '%Newsletter%' OR QualifiedApiName LIKE '%OptOut%' OR QualifiedApiName LIKE '%OptedOut%')
```

If `Subscribed_to_Org_Newsletter__c` doesn't exist exactly under that name, replace it everywhere below with the real one. Stop and ping me with the actual field name before proceeding.

## Step 2 — Top-level SF counts

These are the headline numbers. Run each, record the result.

### 2.1 — Total contacts with an email on file

```sql
SELECT COUNT(Id) total_with_email
FROM Contact 
WHERE Email != NULL
```

### 2.2 — Newsletter-subscribed

```sql
SELECT COUNT(Id) subscribed_count
FROM Contact 
WHERE Subscribed_to_Org_Newsletter__c = TRUE
```

### 2.3 — Globally opted out of all email

```sql
SELECT COUNT(Id) opted_out_count
FROM Contact 
WHERE HasOptedOutOfEmail = TRUE
```

### 2.4 — Effective newsletter audience (the right number to migrate)

```sql
SELECT COUNT(Id) effective_newsletter_audience
FROM Contact 
WHERE Subscribed_to_Org_Newsletter__c = TRUE 
  AND HasOptedOutOfEmail = FALSE
  AND Email != NULL
```

**This is the core number.** If this matches ~43K, the SF data and your operator memory agree. If it's wildly different (e.g., 25K vs. 43K), the gap tells us something — most likely either:
- A subset of Mailchimp subscribers aren't in SF at all (the "donor/partner not a volunteer" case)
- `Subscribed_to_Org_Newsletter__c` is undermaintained (operators forget to set it true on new signups)

### 2.5 — Conflict cases (data hygiene)

```sql
SELECT COUNT(Id) conflict_subscribed_but_opted_out
FROM Contact 
WHERE Subscribed_to_Org_Newsletter__c = TRUE 
  AND HasOptedOutOfEmail = TRUE
```

If this is non-zero, you have contacts where one field says "yes" and the other says "no." Standard interpretation: **`HasOptedOutOfEmail = TRUE` wins** (the global opt-out is the legally-binding signal). Document the count; we treat them as opted out for Phase C.

## Step 3 — Volunteer vs non-volunteer split

The Phase C migration decision hinges on this. Non-volunteer contacts aren't in our canonical DB today (per `D-033`). If they're a meaningful fraction of the newsletter audience, we need a one-time donor import before Phase C.

### 3.1 — Newsletter-subscribed AND volunteer-anchored

```sql
SELECT COUNT(Id) newsletter_volunteers
FROM Contact
WHERE Subscribed_to_Org_Newsletter__c = TRUE
  AND HasOptedOutOfEmail = FALSE
  AND Email != NULL
  AND Id IN (SELECT Contact__c FROM Expedition_Members__c WHERE Contact__c != NULL)
```

### 3.2 — Newsletter-subscribed AND NOT volunteer-anchored (the worry case)

```sql
SELECT COUNT(Id) newsletter_non_volunteers
FROM Contact
WHERE Subscribed_to_Org_Newsletter__c = TRUE
  AND HasOptedOutOfEmail = FALSE
  AND Email != NULL
  AND Id NOT IN (SELECT Contact__c FROM Expedition_Members__c WHERE Contact__c != NULL)
```

**The ratio matters more than the absolute number.** Three scenarios:

| Volunteer % of newsletter audience | What it means for Phase C |
|---|---|
| **>95%** | Clean migration. The donor/partner tail is small enough to ignore or hand-import. |
| **80-95%** | Worth a one-time import script. Brief C1 includes a `import-mailchimp-non-volunteer-newsletter-subscribers` ops step. |
| **<80%** | Significant donor/partner presence on the newsletter. Architectural question: do we re-open `D-033` to allow non-volunteer SF Contact ingest, or do we treat the newsletter audience as fundamentally hybrid (SF + Mailchimp-only segment)? |

### 3.3 — Sample the non-volunteer rows for context

```sql
SELECT Id, Name, Email, AccountId, Account.Name, CreatedDate
FROM Contact
WHERE Subscribed_to_Org_Newsletter__c = TRUE
  AND HasOptedOutOfEmail = FALSE
  AND Email != NULL
  AND Id NOT IN (SELECT Contact__c FROM Expedition_Members__c WHERE Contact__c != NULL)
ORDER BY CreatedDate DESC
LIMIT 20
```

Eyeball the result. Are they:
- Identifiable individuals (donors, board, partners) → import them
- Generic test/dummy contacts → exclude them, mark for SF cleanup
- Old former volunteers whose Expedition_Members records expired → reopen with operator: should they be on the newsletter?

## Step 4 — Pull the Mailchimp audience

You need the full list of Mailchimp newsletter subscribers as a CSV.

### 4.1 — From the Mailchimp dashboard (simplest)

1. Mailchimp → Audience → All Contacts → filter to "Subscribed" status (drop pending/unsubscribed/cleaned)
2. Export → CSV (this can take a few minutes for a 40K audience)
3. Save as `mailchimp-newsletter-audience-YYYY-MM-DD.csv`

### 4.2 — Programmatically (more reliable, scriptable)

Use the existing `MAILCHIMP_API_KEY` from Railway env. The Mailchimp REST API:

```text
GET https://<dc>.api.mailchimp.com/3.0/lists/{audience-id}/members
  ?status=subscribed
  &count=1000
  &offset=0
```

Paginate by incrementing `offset` until the response returns fewer than 1000 rows. Each row has `email_address`, `status`, `timestamp_signup`, `merge_fields.FNAME`, `merge_fields.LNAME`.

We don't have a current ops script for this; if we want it scripted, that's a small one-off ~50-line Node script in `apps/worker/src/ops/audit-mailchimp-newsletter-audience.ts` following the existing ops pattern. Easy to add if the dashboard export proves painful at 43K.

## Step 5 — Reconcile in Postgres

Load both data sets into temp tables in Railway Postgres, then run join queries. This is much faster than trying to match in Excel/Google Sheets at 43K rows.

### 5.1 — Load both data sets

Connect to Postgres via the `DATABASE_PUBLIC_URL`:

```bash
PGURL='postgresql://postgres:...@hopper.proxy.rlwy.net:21680/railway'
psql "$PGURL"
```

Create temp tables:

```sql
CREATE TEMP TABLE audit_sf_newsletter (
  sf_contact_id text PRIMARY KEY,
  email text NOT NULL,
  has_expedition_member boolean NOT NULL,
  has_opted_out_of_email boolean NOT NULL,
  subscribed_to_newsletter boolean NOT NULL
);

CREATE TEMP TABLE audit_mailchimp_audience (
  email text PRIMARY KEY,
  status text NOT NULL,
  signed_up_at timestamptz
);
```

Bulk-load each from the SF export and the Mailchimp CSV using `\copy` (psql's client-side CSV loader):

```sql
\copy audit_sf_newsletter FROM 'sf-newsletter-export-YYYY-MM-DD.csv' CSV HEADER
\copy audit_mailchimp_audience FROM 'mailchimp-newsletter-audience-YYYY-MM-DD.csv' CSV HEADER
```

(For the SF side, you'll want to run a richer SOQL than the count queries above to export `Id, Email, HasOptedOutOfEmail, Subscribed_to_Org_Newsletter__c`, plus a flag for `Id IN (SELECT Contact__c FROM Expedition_Members__c)`. Workbench supports CSV export.)

### 5.2 — Run the reconciliation queries

#### 5.2.1 — In both SF and Mailchimp, agreement: subscribed in both

```sql
SELECT COUNT(*) agreed_subscribed
FROM audit_sf_newsletter s
JOIN audit_mailchimp_audience m 
  ON LOWER(BTRIM(s.email)) = LOWER(BTRIM(m.email))
WHERE s.subscribed_to_newsletter = TRUE
  AND s.has_opted_out_of_email = FALSE
  AND m.status = 'subscribed';
```

#### 5.2.2 — Drift: SF says subscribed, Mailchimp doesn't have them

```sql
SELECT COUNT(*) sf_says_subscribed_not_in_mailchimp
FROM audit_sf_newsletter s
WHERE s.subscribed_to_newsletter = TRUE
  AND s.has_opted_out_of_email = FALSE
  AND NOT EXISTS (
    SELECT 1 FROM audit_mailchimp_audience m
    WHERE LOWER(BTRIM(s.email)) = LOWER(BTRIM(m.email))
      AND m.status = 'subscribed'
  );
```

These are people who think they're subscribed in SF but aren't actually getting the newsletter. Could be Mailchimp cleaned bounces, or SF was set true but they never actually opted in. Need operator interpretation.

#### 5.2.3 — Drift: in Mailchimp, not in SF at all (the donor/partner case)

```sql
SELECT COUNT(*) in_mailchimp_not_in_sf
FROM audit_mailchimp_audience m
WHERE m.status = 'subscribed'
  AND NOT EXISTS (
    SELECT 1 FROM audit_sf_newsletter s
    WHERE LOWER(BTRIM(s.email)) = LOWER(BTRIM(m.email))
  );
```

**This is the critical number.** If this is large, Phase C needs a donor-import step. If it's small (<5% of total), we can hand-import or drop those contacts at migration time.

Sample them to understand who they are:

```sql
SELECT m.email, m.signed_up_at
FROM audit_mailchimp_audience m
WHERE m.status = 'subscribed'
  AND NOT EXISTS (SELECT 1 FROM audit_sf_newsletter s WHERE LOWER(BTRIM(s.email)) = LOWER(BTRIM(m.email)))
ORDER BY m.signed_up_at DESC
LIMIT 50;
```

#### 5.2.4 — Compliance risk: opted out in SF but still in Mailchimp

```sql
SELECT COUNT(*) opted_out_but_still_in_mailchimp
FROM audit_sf_newsletter s
JOIN audit_mailchimp_audience m 
  ON LOWER(BTRIM(s.email)) = LOWER(BTRIM(m.email))
WHERE s.has_opted_out_of_email = TRUE
  AND m.status = 'subscribed';
```

These should be **zero or near-zero**. If non-zero, it means someone opted out in SF but the SF→Mailchimp sync never happened (or doesn't exist). We've been sending newsletters to people who asked us to stop. Document the count and put it on the immediate-fix list — happens at Phase C migration regardless.

#### 5.2.5 — Volunteer-anchored fraction

```sql
SELECT 
  COUNT(*) FILTER (WHERE s.has_expedition_member = TRUE) AS volunteer_in_both,
  COUNT(*) FILTER (WHERE s.has_expedition_member = FALSE) AS non_volunteer_in_both,
  COUNT(*) AS total_in_both
FROM audit_sf_newsletter s
JOIN audit_mailchimp_audience m 
  ON LOWER(BTRIM(s.email)) = LOWER(BTRIM(m.email))
WHERE s.subscribed_to_newsletter = TRUE
  AND s.has_opted_out_of_email = FALSE
  AND m.status = 'subscribed';
```

Compute the percentage: `volunteer_in_both / total_in_both`. Plug into the decision matrix at 3.2 above.

## Step 6 — Write up findings

Save a short report next to this doc as `stage-5a-phase-c-audit-results-YYYY-MM-DD.md`. Template:

```markdown
# Phase C Newsletter Audit Results — YYYY-MM-DD

## Headline numbers
- Total SF contacts with email: ___
- SF says newsletter-subscribed: ___
- SF says globally opted out: ___
- Effective SF newsletter audience: ___
- Mailchimp subscribed count: ___

## Volunteer split
- Newsletter-subscribed AND volunteer-anchored: ___ (___%)
- Newsletter-subscribed AND non-volunteer: ___ (___%)

## Reconciliation
- Agreed (subscribed in both): ___
- SF-says-yes-but-not-in-Mailchimp: ___
- In-Mailchimp-not-in-SF: ___ ← critical for migration decision
- Opted-out-in-SF-but-still-in-Mailchimp: ___ ← compliance flag

## Decision
Based on the above:
- Phase C migration is [clean | needs-donor-import | hybrid-segment]
- Brief C1 must include: [list specific work]
- Outstanding fix-needed: [list compliance items if any]

## Spot-checks
[Paste 10-20 sample rows from each interesting bucket]
```

Commit this results file to the repo so future architects can see the historical state.

## Step 7 — Decisions that flow from this

The results determine three Brief C1 line items:

1. **Donor-import requirement** — does Brief C1 include a one-time `import-mailchimp-non-volunteer-subscribers` ops script?
2. **`D-033` reopening** — if the non-volunteer fraction is >20%, does the canon need a new exception for "newsletter-eligible non-volunteer contacts can be canonical platform contacts"?
3. **Pre-migration cleanup** — any compliance-risk contacts (opted out in SF but in Mailchimp) need to be cleaned BEFORE the first platform-sent newsletter, not after.

The audit feeds these answers into Brief C1; Brief C1 doesn't need to make them in the abstract.

## When to run this

Anytime after `D-045` is locked (which is now). The audit is read-only on both sides — running it doesn't change anything. Best done at least 2 weeks before Phase C kicks off so there's time to act on the findings (e.g., if a donor-import script is needed, that's a ~1-week build).

## Estimated time

- SOQL queries: 30 min
- Mailchimp export: 30 min (mostly waiting on Mailchimp)
- Postgres reconciliation: 30 min
- Write-up: 30 min
- **Total: ~2 hours of focused work** spread across one or two sittings

## Read next

- the Stage 5A impl spec this prep feeds into: [stage-5a-campaigns.md](./stage-5a-campaigns.md) (Brief C0)
- the Mailchimp decommission runbook that runs after Phase C: [mailchimp-decommission.md](../runbooks/mailchimp-decommission.md)
- canon authority: `D-027` (non-SF contacts first-class), `D-033` (SF comms ingest excludes non-volunteers)
