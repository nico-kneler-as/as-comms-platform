# Stage 4 AI Pipeline

**Role:** implementation-ready Stage 4 AI drafting pipeline and grounding contract
**Audience:** implementers building the Stage 4 backend orchestration service, Composer integration points, or Notion knowledge cache
**When to read:** before defining Stage 4 modules, prompt contracts, data model, or the Composer `draft:generate` surface
**Authority:** implementation-spec guidance under the core canon; `D-032` and `D-008` / `D-009` still win on contradictions

## Summary

- Stage 4 is a **human-in-the-loop drafting assistant**, not an autonomous agent.
- Implementation is a **single backend orchestration service** living in the restart repo, not a separate microservice.
- **Anthropic (Claude Sonnet 4.6)** is the draft-generation model provider; OpenAI `text-embedding-3-small` is the embedding provider for tier-5 memory similarity (dual-vendor accepted for MVP). The product app owns orchestration, grounding order, safety, fallback, and explainability.
- **Strict grounding order** (top wins): general instructions → project-specific instructions → approved knowledge → current conversation/contact/project context → reusable approved-reply memory.
- **One LLM call** by default; a second only for reprompt or hard cases. Deterministic fallback is required.
- Visible grounding is a **product contract**, not a nice-to-have.
- Composer landing is a prerequisite (see `D-026`): Stage 4 plugs into a Composer that can already send real messages.
- Cost ~10–15¢/response is acceptable; daily spend is soft-capped at **$20/day** org-wide via `AI_DAILY_CAP_USD` (warn-only, not a hard block). Optimize for trust, quality, debuggability over marginal cost.

## Locked

- no auto-send (`D-009`)
- Notion is the knowledge source, background sync/cache, no approval gate (`D-008`)
- reusable memory is captured **only** from human-approved sent replies
- raw historical threads are **not** primary model input — retrieval pulls bounded, relevant slices
- Fin-like product discipline, lighter Fin-like runtime complexity

## Not In Scope

- autonomous agent chains, tool-use loops, multi-step planners
- real-time streaming drafts
- voice input
- multi-model comparison / A-B draft UIs
- manual memory-curation tooling (bulk edit, delete approved-reply examples)
- operator-specific style memory (e.g., "Jordan writes shorter"; may ship later)
- campaign authoring drafts (Stage 5A territory)
- SMS drafts (Stage 4 scope is email one-to-one; SMS is so terse that LLM drafting is low-value)

## Grounding Order

Every draft request composes a grounding bundle in this fixed priority order. Higher tiers outrank lower tiers on conflict; the prompt must preserve the hierarchy so the model cannot silently invert it.

| Priority | Tier | Typical source | Resolver |
| --- | --- | --- | --- |
| 1 | general instructions | Notion page: "AS global AI instructions" | instruction retriever |
| 2 | project-specific instructions | Notion page per project (e.g., "PNW Biodiversity instructions") | instruction retriever |
| 3 | approved knowledge | Notion knowledge pages cached in `ai_knowledge_entries` | knowledge retriever |
| 4 | current conversation + contact + project context | live Stage 1 projections: inbox row, timeline, memberships | context retriever |
| 5 | reusable approved-reply memory | past sent replies captured post-approval, stored as `aiDurableState` with `kind=resolved_reply_example` | memory retriever |

### Grounding rules

- instructions and approved knowledge outrank prior examples
- prior examples are **pattern support**, not templates; the model must not copy them verbatim
- if a retrieval tier returns nothing, downstream tiers may still fire
- retrieval limits per tier (defaults — tune per measured quality):
  - general instructions: 1 page (always)
  - project-specific instructions: 1 page (if a project context resolves)
  - approved knowledge: up to 5 relevant chunks
  - context: last 20 canonical events for the contact OR 90 days (whichever is smaller); each event body truncated to ~500 characters; target inbound always included in full; no inline images / attachments passed into the prompt; plus project metadata (alias, project name, active state)
  - reusable approved-reply memory: up to 3 most similar approved replies

## Runtime Pipeline

A draft request walks this pipeline end-to-end. Each stage is a discrete module; stages fail fast with explicit error taxonomy.

### A. Preflight / refinement

**Inputs:** incoming draft request (contactId, thread excerpt, optional operator prompt, mode `email`)
**Produces:** classified retrieval task (intent label, safety flags, ambiguity flags) or an early `ask_clarification` / `recommend_handoff` directive.

- classify the inbound message intent (question / request / confirmation / complaint / logistics / etc.)
- detect safety issues (PII leakage risk, out-of-policy request, legal/medical content)
- detect ambiguity (multiple plausible interpretations) — may short-circuit to `ask_clarification` response mode before any retrieval

### B. Retrieval / grounding

**Inputs:** classified task
**Produces:** grounding bundle (ordered by tier, with source provenance per item)

- execute the 5 retrievers in priority order
- assemble the grounding bundle
- record retrieval provenance: source kind, source ID, similarity score if applicable

### C. Response-mode decision

**Inputs:** grounding bundle + classification
**Produces:** one of four modes — `draft` / `ask_clarification` / `recommend_handoff` / `deterministic_fallback`

- `draft`: retrieval produced sufficient grounding to attempt a response
- `ask_clarification`: the incoming message is too ambiguous; produce a short clarification question instead of a draft
- `recommend_handoff`: safety or policy flag detected; produce a visible recommendation that the operator escalate (no draft body)
- `deterministic_fallback`: model is unavailable or retrieval produced nothing usable; fall back to a template response that acknowledges receipt and promises human follow-up

### D. Draft generation

**Inputs:** grounding bundle + response mode = `draft`
**Produces:** LLM-generated draft with grounding-anchor metadata

- one LLM call with the compact grounding bundle and **masked/minimized** context (redact PII in prompts; never ship raw full message archives)
- the prompt preserves the grounding priority order and instructs the model to cite the tier each claim is drawn from (internal signal for validation)
- model temperature tuned for consistency over creativity (draft assistance, not copywriting)

### E. Validation

**Inputs:** generated draft + grounding bundle
**Produces:** validated draft OR `failed_validation` with reasons

- check: does the draft actually answer the incoming message?
- check: are all factual claims traceable to the grounding bundle? (no unsupported claims)
- check: is the grounding hierarchy honored? (no tier 5 example overriding tier 1 instruction)
- check: does the draft avoid forbidden content categories (raw PII from other contacts, internal notes verbatim, etc.)?
- on failure: either fall back to `deterministic_fallback` or surface a structured error to the operator

### F. Explainability

**Inputs:** validated draft + grounding bundle + validation result
**Produces:** response payload returned to the Composer — draft body + grounding-source display + warnings

- every draft ships with a **visible source list** the operator can expand
- warnings surface when validation flagged something suspect but didn't block
- the UI must render explainability even when deterministic fallback is used ("AI unavailable; this is a template response")

### G. Memory capture

**Inputs:** human-sent reply (post-Composer send) + the draft that inspired it + the grounding bundle
**Produces:** new `aiDurableState` row with `kind=resolved_reply_example` (only if human approved/edited/sent)

- only human-sent replies become reusable memory
- drafts discarded, reprompted, or abandoned **do not** enter memory
- capture stores the final sent text, the original incoming message, and a summary of the grounding tier that most closely matched, for future similarity search

## Implementation Modules

The orchestration service is a single backend module with internal components. Module names are implementation-ready suggestions; names may change, responsibilities may not.

| Module | Responsibility | Dependencies |
| --- | --- | --- |
| request normalizer / classifier | parse draft request, classify intent, detect safety/ambiguity | Stage 1 contact + timeline repos |
| policy gate | hard-deny out-of-policy requests before retrieval | static policy config |
| instruction retriever | pull tier-1 + tier-2 Notion instructions from cache | `ai_knowledge_entries` |
| knowledge retriever | retrieve tier-3 approved knowledge chunks | `ai_knowledge_entries`, future chunking / retrieval layer |
| context retriever | read live Stage 1 contact timeline, project memberships | Stage 1 repositories via composition root |
| memory retriever | retrieve tier-5 approved-reply examples by similarity | `aiDurableState` resolved-reply memory, embedding search |
| grounding assembler | merge retriever outputs into ordered bundle with provenance | above retrievers |
| response-mode decider | pick draft / clarify / handoff / fallback | classifier + grounding coverage |
| prompt builder | compose final model prompt with grounding hierarchy, masking | grounding bundle + prompt templates |
| provider adapter | call Anthropic (Claude Sonnet 4.6), handle retries, timeouts | provider credentials, network adapter |
| validator | post-generation checks (answers, grounded, hierarchy, PII) | grounding bundle + generated draft |
| fallback builder | deterministic non-LLM response when provider fails or validation blocks | static template set |
| grounding presenter | shape the explainability payload for the Composer UI | grounding bundle + validation outcome |
| memory capture service | post-send hook that promotes a sent reply into reusable memory | post-send Composer callback |

## Composer Integration

Composer is the only caller of the draft pipeline in Stage 4 scope.

### Request shape

A Composer "AI draft" action invokes a Server Action that hits the orchestration service with:

- `contactId` — canonical contact whose thread the draft targets
- `mode` — `email` in Stage 4 (reserved for future SMS)
- `prompt` — optional operator brief ("ask about training availability")
- `threadCursor` — optional reference to the specific inbound being replied to

### Response shape

The orchestration service returns a response that the Composer renders directly:

- `draft` — text body (or empty for `recommend_handoff` / `ask_clarification` modes)
- `mode` — one of `draft` / `ask_clarification` / `recommend_handoff` / `deterministic_fallback`
- `grounding` — ordered source list for the explainability panel
- `warnings` — typed warnings array; each entry carries a `code` drawn from `{provider_timeout, provider_rate_limited, over_budget, validation_blocked, grounding_empty, notion_stale, budget_warn}` plus a human-readable `message`
- `cost_estimate_usd` — estimated cost of this call; feeds the daily-spend rollup for the $20/day cap
- `provider_status` — one of `ok` / `degraded` / `unavailable` for the draft-generation provider
- `draftId` — stable ID for later memory capture linking

Failure-mode rules:

- `over_budget` — emit a `budget_warn` warning, still produce a draft; do NOT hard-block the operator
- `grounding_empty` — still produce a draft with a `grounding_empty` warning surfaced above it ("not enough context for this project yet")
- `notion_stale` — never blocks drafting; surfaces as an informational warning only
- `provider_timeout` / `provider_rate_limited` / `validation_blocked` — collapse into `mode = deterministic_fallback` with the corresponding warning code

### Post-send memory hook

On successful Composer send, the Server Action must call the memory capture service with:

- `draftId` — to link the pre-edit draft and grounding bundle
- `sentBody` — the final text the operator sent (post-edit)
- `contactId` + thread context

Capture happens only once the send succeeds. Send failure does not capture memory.

## Data Model

Stage 4 splits durable state across two tables:

- **`ai_knowledge_entries`** (new table, migration `0020`): tier 1–3 cache — general instructions, project instructions, approved knowledge — populated by the Notion background sync job per `D-008`. Keyed by `(source_provider, source_id)`; each row carries a `scope` column (`global` | `project`) and `scope_key` (NULL for global, `project_id` for project). Discovery matches Notion's `Project ID` property to `project_dimensions.project_id` — there is no per-project URL wiring. See brief `.codex-stage4-notion-knowledge-sync-2026-04-21.md`.
- **`aiDurableState`** (existing contract — see [`../01-core/interfaces-core.md`](../01-core/interfaces-core.md)): tier 5 reusable memory and operator feedback only. Knowledge does NOT live here.

Expected `kind` values on `aiDurableState`:

| Kind | Content | Source | Lifecycle |
| --- | --- | --- | --- |
| `resolved_reply_example` | final sent reply + inbound + grounding summary. PII masked: first names → `{NAME}`, full emails → `{EMAIL}`, phones → `{PHONE}`; product and expedition terms preserved. Paired with an OpenAI `text-embedding-3-small` vector for cosine-similarity retrieval. | post-Composer-send memory capture | append-only; humans may later mark as low-quality; dedup via cosine > 0.95 within the same `project_id`; no TTL |
| `assistant_feedback` | operator feedback on a draft (e.g., "reprompt", "discard", "edited 60%") | inline Composer feedback controls | append-only; used for prompt tuning signals |

## Fallback Contract

Deterministic fallback must succeed when the provider fails or validation blocks.

- template set: curated short acknowledgement responses per intent class (question / logistics / complaint / general)
- the fallback response is visibly labeled in the UI as a non-LLM template
- the operator can still edit and send it or discard
- fallback **does not** produce a reusable memory capture on send (prevents poisoning the memory pool with generic text)

## Explainability Contract

The Composer's grounding panel must answer:

- which instruction(s) shaped the tone?
- which knowledge pages informed the factual claims?
- which prior approved replies supported the pattern?
- what was the response mode, and why?
- which validation warnings fired?

The UI MAY collapse this behind an "About this draft" disclosure. It MUST NOT hide the fact that AI was used, even for deterministic fallback.

## Cost And Runtime Balance

- one LLM call by default for draft generation
- a second LLM call only for reprompting (operator clicks "regenerate") or hard validation failures
- retrieval, classification, validation, and fallback construction stay in normal backend code
- embedding retrieval calls (if used) are cheap and excluded from the "one LLM call" count
- target p95 end-to-end latency: 3–6s for a single draft (UX: operator is waiting)
- daily spend cap: soft-warn at **$20/day** org-wide via `AI_DAILY_CAP_USD` env var. Each response carries a `cost_estimate_usd` that the orchestration service rolls up; when the day's projected spend exceeds the cap, responses emit a `budget_warn` warning alongside the draft. Over-budget NEVER hard-blocks — the operator always gets a draft or a deterministic fallback.

## Explicitly Deferred From Stage 4

- agent-style multi-turn conversation with the assistant
- auto-send after N hours with no operator review (violates `D-009`)
- operator style personalization memory
- multi-model comparison / best-of-N drafts
- streaming token-by-token UI
- manual memory curation tools
- campaign authoring drafts (belongs to Stage 5A)
- SMS drafting (email-only in Stage 4; SMS may arrive when Stage 1C SimpleTexting activation returns)

## Read Next

- decision context: [`../01-core/decision-core.md`](../01-core/decision-core.md) (`D-008`, `D-009`, `D-026`, `D-032`)
- data model: [`../01-core/data-core.md`](../01-core/data-core.md) + [`../01-core/interfaces-core.md`](../01-core/interfaces-core.md) (`aiDurableState`)
- Composer scope: `../02-bundles/composer-bundle.md` (pending — authored when Composer build begins per `D-026`)
