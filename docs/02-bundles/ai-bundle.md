# AI Bundle

**Role:** task packet for Stage 4 AI assistant work  
**Audience:** implementers working on grounded drafts, memory, or AI UX  
**When to read:** before AI drafting, retrieval, or feedback work  
**Authority:** derivative bundle; core truth lives in `01-core/*`

## Purpose

Add grounded draft generation and reusable memory retrieval without surrendering human control.

## Required Reading

1. [00-index.md](../00-index.md)
2. [product-core.md](../01-core/product-core.md)
3. [system-core.md](../01-core/system-core.md)
4. [data-core.md](../01-core/data-core.md)
5. [engineering-core.md](../01-core/engineering-core.md)
6. [frontend-patterns.md](../01-core/frontend-patterns.md)
7. [delivery-core.md](../01-core/delivery-core.md)
8. [decision-core.md](../01-core/decision-core.md)

## Locked

- AI never sends automatically
- Notion remains the source for instructions and approved knowledge
- knowledge sync uses background cache refresh, not approval-heavy manual activation
- resolved approved replies may become reusable memory
- retrieved examples never outrank instructions or approved knowledge
- per-project AI Knowledge is an n-source registry (`ai_knowledge_sources`) of Notion pages and public web URLs, merged into one cached document by the synthesis worker (per `D-043`); operators manage sources via the Settings wizard and project detail page
- per-project `ai_auto_sync_schedule` (`'never' | 'daily' | 'weekly'`) drives an hourly `poll-ai-knowledge-auto-sync` cron; orchestrator hashes all enabled-source content and short-circuits before the LLM call when the hash matches stored `ai_optimized_input_hash`
- "Send and save for AI" sets `approved_for_ai=true` directly (per `D-032`); when ≥5 approved-for-AI rows accumulate since the last synthesis, an `ai-knowledge-capture-trigger:{projectId}` job is enqueued with `skipIfHashUnchanged=false` (approved replies are the change signal)
- there is no separate Tier-3 review/edit/delete UI; the deliberate "Send and save for AI" click is the approval
- connected sub-projects (per `D-044`) inherit AI Knowledge from their host via the alias-host-hop fallback (PR #405); they do not maintain their own cached doc

## Required Interfaces / Concepts

- grounded draft generation
- reprompt/regenerate
- visible grounding or source explanation
- resolved reply example store
- assistant feedback capture
- multi-source registry CRUD (per project: add Notion page or web URL with optional label, enable/disable, remove)
- synthesis orchestrator (worker job + ops CLI) that fetches enabled sources, computes input hash, skips LLM call on unchanged hash, otherwise calls Claude and writes a versioned `{Project} — AI Knowledge (vN)` Notion page back into the workspace
- auto-sync schedule per project plus an explicit Resync affordance on the project detail page
- threshold-triggered re-synthesis from `captureKnowledgeFromSend` (graceful enqueue failure: capture must succeed even if the trigger queue is down)

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

- security and review gate: [verification-security-bundle.md](./verification-security-bundle.md)
