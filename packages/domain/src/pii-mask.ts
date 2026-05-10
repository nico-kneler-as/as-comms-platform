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
 */
export function maskKnowledgeExample(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "{EMAIL}")
    .replace(/\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/gu, "{PHONE}")
    .replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/gu, "{NAME}");
}
