# Reference Salesforce Mapping

**Role:** compact Salesforce mapping reminder  
**Audience:** implementers touching identity, memberships, lifecycle events, or campaign metadata  
**When to read:** only when a task depends on Salesforce data contracts  
**Authority:** reference-only; core truth lives in `01-core/data-core.md` and `01-core/decision-core.md`

## Locked High-Value Mapping Truth

- Salesforce Contact ID is the primary identity anchor.
- Canonical volunteer id comes from `Contact.Volunteer_ID_Plain__c`.
- Contact and expedition-member foundation are in first locked journey scope.
- First locked lifecycle milestones:
  - signed up
  - received training
  - completed training
  - submitted first data
- Task-based outbound communication metadata is the primary tested Salesforce communication source in the restart scope.

## Use This For

- identity resolution
- membership context
- lifecycle event mapping
- Salesforce-sourced communication context

## Deep Reference

- full mapping details: [`../../restart-prd/salesforce-mapping-reference.md`](../../restart-prd/salesforce-mapping-reference.md)
