# Stage 1 Provider Ingest Matrix

**Role:** minimum first-pass ingest scope by provider for Stage 1 implementation  
**Audience:** implementers designing provider adapters, normalization, identity resolution, and source-evidence storage  
**When to read:** before defining first-pass provider ingest work  
**Authority:** implementation-spec guidance under the core canon

## Summary

- narrowed launch-scope completion is Gmail + Salesforce only
- SimpleTexting and Mailchimp remain valid Stage 1 architecture paths, but they are deferred for initial launch acceptance
- Historical backfill and live ingest must map into the same normalization path.
- Keep provider scope narrow and explicit.
- If a source record cannot be mapped safely in Stage 1, defer it or send it to review; do not widen the matrix by guesswork.

## Gmail

### Required first pass

- one-to-one inbound email messages
- one-to-one outbound email messages
- provider-close message evidence needed for replay-safe dedupe and provenance
- mailbox context needed to explain:
  - which historical project inbox mailbox a record came from
  - whether a live record was captured from `volunteers@...`
  - which project inbox alias the live Gmail record represented when different from the captured mailbox

### Deferred

- drafts
- read-state and mailbox labels
- attachment extraction beyond metadata or payload references
- bounce, delivery, or mailbox-rule families

### Identity fields expected from source

- normalized external email address or addresses
- Gmail message ID
- RFC 822 message identifier when present
- Gmail thread ID as supporting context only
- sent or received timestamp

### Canonical event types this provider may produce

- `communication.email.inbound`
- `communication.email.outbound`

### Important ambiguity or conflict cases

- multiple plausible external contacts in one message
- alias or shared mailbox addresses
- outbound email also logged in Salesforce task metadata
- replay of the same Gmail message with changed payload shape

### Historical backfill vs live ingest

- historical backfill must cover the full project inbox mailbox set needed to reconstruct volunteer history
- live Gmail sync is narrowed to `volunteers@...`, which sends and receives on behalf of the project inbox aliases
- both historical fetches and live deltas use the same normalization and dedupe rules
- thread IDs are evidence only; they must not turn the model into a thread-first Inbox

### Tie-break and identity-anchor notes

- Gmail wins duplicate collapse when the same outbound one-to-one email is also described by Salesforce
- when Gmail can be linked to a Salesforce-anchored contact through canonical identities, use that anchor
- when Gmail participant matching is ambiguous, open identity review instead of fanning out to multiple contacts

## Salesforce

### Required first pass

- `Contact` records needed for canonical contact identity
- `Expedition_Members__c` records needed for membership and lifecycle context
- the locked lifecycle milestones:
  - `signed_up`
  - `received_training`
  - `completed_training`
  - `submitted_first_data`
- `Task`-based outbound communication metadata as the only first-scope Salesforce communication source

### Deferred

- broader object families outside `Contact`, `Expedition_Members__c`, `Task`, and locked lifecycle scope
- owner or tag-oriented CRM concepts
- additional lifecycle milestones not named in canon
- CRM-only communication metadata that cannot be mapped safely to a canonical event

### Identity fields expected from source

- Salesforce Contact ID
- `Contact.Volunteer_ID_Plain__c`
- normalized email and phone values available on the contact
- project or expedition identifiers
- provider record IDs for lifecycle or communication metadata

### Canonical event types this provider may produce

- `lifecycle.signed_up`
- `lifecycle.received_training`
- `lifecycle.completed_training`
- `lifecycle.submitted_first_data`
- `communication.email.outbound` from `Task` auto-message evidence only
- `communication.sms.outbound` from `Task` auto-message evidence only

### Important ambiguity or conflict cases

- Salesforce Contact ID conflicts with a weaker email- or phone-based link
- one normalized email or phone matches multiple contacts
- task metadata duplicates a Gmail or SimpleTexting transport record
- routing context from memberships conflicts with provider-supplied activity context

### Historical backfill vs live ingest

- historical extracts and live deltas must reuse the same normalization path
- lifecycle milestones should remain canonical lifecycle events whether they arrive from history or delta updates
- lifecycle events must only come from:
  - `Expedition_Members__c.CreatedDate`
  - `Expedition_Members__c.Date_Training_Sent__c`
  - `Expedition_Members__c.Date_Training_Completed__c`
  - `Expedition_Members__c.Date_First_Sample_Collected__c`
- live `Contact` and `Expedition_Members__c` freshness should stay CDC-compatible where available, while `Task` remains delta-poll friendly

### Tie-break and identity-anchor notes

- Salesforce Contact ID is the strongest identity anchor when present
- Gmail wins for duplicate collapse of the same outbound one-to-one email
- SimpleTexting wins as the primary source for the same outbound SMS when transport evidence exists there

## SimpleTexting

Launch-scope note:

- deferred for initial Gmail + Salesforce launch completion

### Required first pass

- inbound one-to-one SMS or MMS messages
- outbound one-to-one SMS or MMS messages
- opt-in and opt-out compliance events

### Deferred

- broadcast or campaign analytics
- deeper media ingestion beyond provider-close evidence
- richer delivery receipt families if they do not affect Stage 1 trust

### Identity fields expected from source

- normalized phone number
- provider message ID
- provider subscriber or contact ID when available
- message timestamp
- compliance keyword or status when available

### Canonical event types this provider may produce

- `communication.sms.inbound`
- `communication.sms.outbound`
- `communication.sms.opt_in`
- `communication.sms.opt_out`

### Important ambiguity or conflict cases

- recycled or shared phone numbers
- multiple contacts share the same normalized phone
- Salesforce outbound communication metadata describes the same SMS
- compliance event arrives for a phone that does not yet map safely to one contact

### Historical backfill vs live ingest

- if historical SMS data is available, map it through the same normalization path as live events
- live transport and compliance events must not bypass the replay-safe source-evidence log

### Tie-break and identity-anchor notes

- SimpleTexting is the primary source for official SMS transport and compliance events
- Salesforce may support provenance or routing context but should not replace SimpleTexting as the primary transport winner
- if the phone number resolves uniquely to a Salesforce-anchored contact, attach it there; otherwise open identity review

## Mailchimp

Launch-scope note:

- deferred for initial Gmail + Salesforce launch completion

### Required first pass

- historical campaign-member activity for:
  - sent
  - opened
  - clicked
  - unsubscribed

### Deferred

- campaign authoring objects
- audience-management semantics beyond what is required to map historical activity
- automation journey internals
- non-transition live ingest if Mailchimp is no longer part of the active cutover path

### Identity fields expected from source

- normalized email address
- Mailchimp member or subscriber identifier
- campaign identifier
- audience or list identifier
- event timestamp

### Canonical event types this provider may produce

- `campaign.email.sent`
- `campaign.email.opened`
- `campaign.email.clicked`
- `campaign.email.unsubscribed`

### Important ambiguity or conflict cases

- the same email address belongs to multiple candidate contacts
- Mailchimp member activity cannot be linked to a Salesforce-anchored person safely
- campaign events are mistaken for one-to-one email events
- transition-period live events disagree with historical backfill for the same campaign-member activity

### Historical backfill vs live ingest

- historical campaign activity is the first-priority Stage 1 scope
- transition-period live ingest uses the same event taxonomy and normalization path only if Mailchimp is still active during cutover

### Tie-break and identity-anchor notes

- Gmail-vs-Salesforce outbound-email tie-break logic does not apply here
- Mailchimp campaign events must stay distinct from one-to-one email events
- when email maps safely to one Salesforce-anchored contact, attach there; otherwise open identity review
