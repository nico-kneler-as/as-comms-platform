/**
 * Shared PII masker for replies stored as AI training data
 * (canonical_reply and corpus_example rows in project_knowledge_entries).
 *
 * Rules match the canonical-reply capture path that has been live since
 * Phase 3 of PRD #366 (apps/web/app/inbox/actions.ts maskKnowledgeExample).
 * Extracted 2026-05-10 so the backfill ops script that builds the bulk
 * email corpus can reuse the exact same masking surface — anything stored
 * as project knowledge passes through this single function.
 *
 * Kept deliberately conservative:
 *   - Email addresses → `{EMAIL}`
 *   - Phone numbers (US-style 10-digit) → `{PHONE}`
 *   - Probable person names (sequences of capitalised tokens, 2-4 words) → `{NAME}`
 *
 * Intentionally NOT masked:
 *   - Project terminology (species names, geography, app names, dates,
 *     elevations) — these are project-specific signal, not PII.
 *   - Single capitalised words (would over-mask common English: "Monday",
 *     "Pacific", project names that legitimately appear in tone signal).
 *   - Greetings and sign-offs — Claude needs these to learn voice.
 *
 * Compliance boundary (security review 2026-05-02 M4):
 *
 * This masker is **heuristic, not regulatory-grade.** Specifically:
 *   - Phone regex matches US-style 10-digit numbers only. International
 *     formats (e.g. `+44 207 123 4567`, `+33 1 ...`) will NOT be masked.
 *   - Name regex requires 2+ consecutive capitalised words. Single first
 *     names in greetings (e.g. "Hi Sarah,") will NOT be masked.
 *   - The following PII categories are NOT masked at all and would leak
 *     to Anthropic if present in a corpus example: physical addresses,
 *     dates of birth, member/donor IDs, social-security-style numbers,
 *     payment card numbers, donation amounts.
 *
 * Acceptable for the current data class — Adventure Scientists volunteer
 * communications are non-regulated PII and Anthropic's DPA covers the
 * processing. If this masker is ever reused for HIPAA-regulated content
 * (e.g. citizen-science health-research volunteers), GDPR-resident data
 * beyond what Anthropic's DPA covers, or financial reconciliation data,
 * **revisit and tighten before extending the corpus surface.** Consider
 * a policy-driven masking library (e.g. presidio) at that point.
 */
export function maskKnowledgeExample(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "{EMAIL}")
    .replace(/\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/gu, "{PHONE}")
    .replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/gu, "{NAME}");
}
