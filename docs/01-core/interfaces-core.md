# Interfaces Core

**Role:** minimum implementation contract for canonical entities  
**Audience:** implementers touching contracts, schemas, repositories, workers, or read models  
**When to read:** after `data-core.md` and before defining tables, DTOs, or job payloads  
**Authority:** authoritative for the minimum initial TypeScript, Zod, and Drizzle contract surface  
**Decides:** the starting names and required fields for core durable entities and payloads  
**Does not decide:** full future field coverage, provider-specific raw payload details, or new business behavior

## Summary

- This file translates `data-core.md` into minimum implementation-ready contracts.
- Each durable concept gets a domain interface, a Zod payload contract, and a Drizzle table stub where relevant.
- These are starting contracts only; semantics must stay faithful to `data-core.md`.

## Locked

- Do not introduce new business entities here.
- Do not weaken identity, replay, projection, or review semantics already locked in `data-core.md`.
- Field names may be implementation-ready, but they must preserve the existing conceptual model.
- Durable tables should default to explicit IDs, timestamps, and stable foreign keys instead of inferred joins.

## Minimum Contract Surface

| Concept | Domain contract | Zod contract | Drizzle table | Minimum required fields |
| --- | --- | --- | --- | --- |
| source evidence log | `SourceEvidenceRecord` | `sourceEvidenceSchema` | `sourceEvidenceLog` | `id`, `provider`, `providerRecordType`, `providerRecordId`, `receivedAt`, `occurredAt`, `payloadRef`, `idempotencyKey`, `checksum` |
| canonical event ledger | `CanonicalEventRecord` | `canonicalEventSchema` | `canonicalEventLedger` | `id`, `contactId`, `eventType`, `channel`, `occurredAt`, `sourceEvidenceId`, `idempotencyKey`, `provenance`, `reviewState` |
| contacts | `ContactRecord` | `contactSchema` | `contacts` | `id`, `salesforceContactId`, `displayName`, `primaryEmail`, `primaryPhone`, `createdAt`, `updatedAt` |
| contact identities | `ContactIdentityRecord` | `contactIdentitySchema` | `contactIdentities` | `id`, `contactId`, `kind`, `normalizedValue`, `isPrimary`, `source`, `verifiedAt` |
| contact memberships | `ContactMembershipRecord` | `contactMembershipSchema` | `contactMemberships` | `id`, `contactId`, `projectId`, `expeditionId`, `role`, `status`, `source` |
| identity resolution queue | `IdentityResolutionCase` | `identityResolutionSchema` | `identityResolutionQueue` | `id`, `sourceEvidenceId`, `candidateContactIds`, `reasonCode`, `status`, `openedAt`, `resolvedAt` |
| routing review queue | `RoutingReviewCase` | `routingReviewSchema` | `routingReviewQueue` | `id`, `contactId`, `sourceEvidenceId`, `reasonCode`, `status`, `openedAt`, `resolvedAt` |
| contact inbox projection | `InboxProjectionRow` | `inboxProjectionSchema` | `contactInboxProjection` | `contactId`, `bucket`, `needsFollowUp`, `hasUnresolved`, `lastInboundAt`, `lastOutboundAt`, `lastActivityAt`, `snippet`, `lastEventType` |
| contact timeline projection | `TimelineProjectionRow` | `timelineProjectionSchema` | `contactTimelineProjection` | `id`, `contactId`, `canonicalEventId`, `occurredAt`, `sortKey`, `eventType`, `summary`, `channel` |
| sync/parity/backfill state | `SyncStateRecord` | `syncStateSchema` | `syncState` | `id`, `provider`, `jobType`, `cursor`, `windowStart`, `windowEnd`, `status`, `parityPercent`, `lastSuccessfulAt`, `deadLetterCount` |
| audit/policy evidence | `AuditEvidenceRecord` | `auditEvidenceSchema` | `auditPolicyEvidence` | `id`, `actorType`, `actorId`, `action`, `entityType`, `entityId`, `occurredAt`, `result`, `policyCode`, `metadataJson` |
| AI durable state | `AiDurableStateRecord` | `aiDurableStateSchema` | `aiDurableState` | `id`, `contactId`, `kind`, `scopeKey`, `contentRef`, `sourceRef`, `approvedAt`, `feedbackLabel` |

## Standard Field Rules

| Rule | Requirement |
| --- | --- |
| `IF-01` | IDs are explicit string IDs or UUIDs; do not rely on provider keys as primary table keys. |
| `IF-02` | Provider identifiers live in dedicated fields, not overloaded into canonical IDs. |
| `IF-03` | Timestamps use explicit UTC instants for durable storage. |
| `IF-04` | Projection tables point back to canonical records with stable foreign keys. |
| `IF-05` | Queue tables model review state explicitly; ambiguity is never hidden in nullable side fields. |
| `IF-06` | Zod payload schemas validate job payloads and route/action IO, not raw provider payload archives. |

## Initial Naming Pattern

- Domain interfaces live in `packages/domain` or `packages/contracts`, depending on whether they model internal state or cross-boundary IO.
- Zod schemas live in `packages/contracts`.
- Drizzle table definitions live in `packages/db`.
- Repository interfaces refer to the domain contract names above, not raw table row types.

## Allowed / Not Allowed

| Allowed | Not allowed |
| --- | --- |
| compact starting schemas with the required fields above | inventing new product concepts or queue semantics |
| splitting provider-close raw payload storage from normalized payload schemas | using raw provider payloads as cross-package contracts |
| additional nullable fields added later when justified by canon | deleting required fields that encode identity, provenance, or replay behavior |
| implementation-specific table naming adjustments if semantics stay the same | changing the meaning of bucket-derived unread, `needsFollowUp`, unresolved, or manual review here |

## Read Next

- conceptual semantics: [`data-core.md`](./data-core.md)
- web mutation and caching rules: [`frontend-patterns.md`](./frontend-patterns.md)
- Stage 1 implementation packet: [`../02-bundles/data-foundation-bundle.md`](../02-bundles/data-foundation-bundle.md)
