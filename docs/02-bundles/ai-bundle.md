# AI Bundle

**Role:** task packet for Stage 4 AI assistant work  
**Audience:** implementers working on grounded drafts, memory, or AI UX  
**When to read:** before AI drafting, retrieval, or feedback work  
**Authority:** derivative bundle; core truth lives in `01-core/*`

## Purpose

Add grounded draft generation and reusable memory retrieval without surrendering human control.

## Required Reading

1. [`../00-index.md`](../00-index.md)
2. [`../01-core/product-core.md`](../01-core/product-core.md)
3. [`../01-core/system-core.md`](../01-core/system-core.md)
4. [`../01-core/data-core.md`](../01-core/data-core.md)
5. [`../01-core/engineering-core.md`](../01-core/engineering-core.md)
6. [`../01-core/frontend-patterns.md`](../01-core/frontend-patterns.md)
7. [`../01-core/delivery-core.md`](../01-core/delivery-core.md)
8. [`../01-core/decision-core.md`](../01-core/decision-core.md)

## Locked

- AI never sends automatically
- Notion remains the source for instructions and approved knowledge
- knowledge sync uses background cache refresh, not approval-heavy manual activation
- resolved approved replies may become reusable memory
- retrieved examples never outrank instructions or approved knowledge

## Required Interfaces / Concepts

- grounded draft generation
- reprompt/regenerate
- visible grounding or source explanation
- resolved reply example store
- assistant feedback capture

## Allowed / Not Allowed

| Allowed | Not allowed |
| --- | --- |
| human-reviewed drafts | auto-send |
| minimized, policy-safe model context | raw uncontrolled history dumps |
| explicit instruction/knowledge/example precedence | hidden retrieval ordering |
| masked or minimized reusable memory | secret or unnecessary PII exposure to models |

## Acceptance

- deterministic fallback exists when AI or retrieval is unavailable
- grounding sources are visible enough for operator trust
- approved reply memory improves reuse without outranking instructions or knowledge
- AI remains a review-only assistive layer

## Common Failure Modes

- overloading the prompt with raw thread history
- mixing instructions, knowledge, and examples without clear precedence
- reintroducing manual knowledge publish/approve friction from the donor project

## Read Next

- security and review gate: [`verification-security-bundle.md`](./verification-security-bundle.md)
