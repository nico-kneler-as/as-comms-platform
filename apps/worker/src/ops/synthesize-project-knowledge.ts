#!/usr/bin/env tsx
/**
 * synthesize-project-knowledge
 *
 * One-off architect tool to synthesize a final AI Knowledge document for a project
 * by combining an existing operator-curated source markdown (e.g., the optimized
 * v2 Notion page) with the project's outbound email corpus.
 *
 * Output: a single markdown document with FAQ patterns extracted from email history,
 * refined tone signals, and the operator-curated facts/escalation rules preserved.
 *
 * Email corpus is read from a JSONL file (one JSON object per line) with shape:
 *   { id, occurred_at, subject, body, alias }
 *
 * Export it from prod with:
 *   echo "\pset format unaligned
 *         \pset tuples_only on
 *         SELECT json_build_object(...) FROM ...;" | railway connect Postgres \
 *     | grep -E '^\\{' > /tmp/<project>-emails.jsonl
 *
 * Usage:
 *   railway run -- pnpm --filter @as-comms/worker exec tsx \
 *     src/ops/synthesize-project-knowledge.ts <existing_md_path> <emails_jsonl_path> <output_md_path> [additional_source_md_path...]
 *
 * Additional source paths are optional; each is treated as a supplementary
 * source whose unique facts should be integrated into (not duplicated in)
 * the existing doc's structure.
 */
import process from "node:process";
import { readFile, writeFile } from "node:fs/promises";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-4-6";

interface EmailRow {
  readonly id: string;
  readonly occurred_at: Date;
  readonly subject: string | null;
  readonly body: string | null;
  readonly alias: string | null;
}

const SYSTEM_PROMPT = `You are organizing an AI training document for a volunteer communications assistant. Your output will be used by an AI to draft replies to volunteers for a specific project.

INPUTS:
- An existing AI Knowledge document (operator-curated; may be partially structured or terse)
- Optionally one or more additional source documents (e.g., volunteer homepage, field protocol PDF, training course content)
- A corpus of past sent replies from this project's volunteer alias(es)

PRODUCE: a comprehensive, self-contained updated AI Knowledge document organized in the following standard structure (adapt section content to the project — but keep these section names and order):

1. **Intro paragraph** — what this page is, what it excludes (internal-only material), what sources were merged.

2. **## What this project is** — 4-6 sentence description of the project (mission, geographic scope, partners, target species/output, how the volunteer experience is shaped).

3. **## What this AI assistant should help with** — bullet list of the AI's scope (volunteer-facing topics it should address, what to prefer, when to be careful about seasonality).

4. **## Tone signals from real volunteer messages** — 6-12 bullets distilled from the email corpus. Cover dominant emotional patterns, common support themes, recurring frustrations, things operators handle gracefully. Keep the most insightful observations from the existing doc's equivalent section if the new corpus confirms them.

5. **## Common volunteer questions and approved answer patterns** — the new corpus-derived section. 8-15 clusters ordered by frequency. For each:
   ### {Topic name as a noun phrase}
   - **Volunteer typically asks:** {paraphrased pattern, anonymized}
   - **Approved answer pattern:** {synthesized voice, 2-4 sentences, based on how operators actually responded}
   - **Tone notes:** {tone signals for this topic}
   - **Approximate frequency:** {very common (>20), common (10-20), occasional (5-10), uncommon but recurring}

6. **## Volunteer-facing facts** — sectioned by topic. Use H3 subsections (### Getting started, ### Fieldwork, ### Equipment, ### Species/target identification, ### Navigation, ### Project timing, etc.) as appropriate for the project. Pull facts from the existing doc AND the additional source documents, deduplicating.

7. **## Phrase these carefully (date-bound or contingent)** — bullets of claims the AI should hedge.

8. **## Never share with volunteers** — bullets of operator-only material.

9. **## Escalate to a human teammate when** — handoff conditions.

10. **## Contact** — project email, general lines, mailing address.

INTEGRATION RULES:
- Treat the existing AI Knowledge doc as authoritative for the project's tone-curated sections (phrase carefully, never share, escalate). Preserve their content; you may rephrase for clarity but do not drop items.
- Treat additional source documents as fact sources. Integrate their unique facts into the appropriate "Volunteer-facing facts" subsections. Do not preserve them verbatim.
- If an additional source contains a knowledge check / quiz, the topics in the quiz indicate what volunteers must know.
- De-duplicate content across all inputs.

PII MASKING in corpus-derived content:
- Replace volunteer first names with {NAME}
- Replace full email addresses with {EMAIL}
- Replace phone numbers with {PHONE}
- Preserve project-specific terms (app names, geographic names, species names, dates, elevations, etc.)

NEVER:
- Invent facts not present in any input
- Include specific volunteer names or PII
- Include one-off operational issues that don't generalize
- Include internal/operator-only commentary
- Add sections beyond what's specified

OUTPUT FORMAT: markdown with H1, H2, H3 headings and bullet lists. Output ONLY the markdown — no preamble, no closing remarks.`;

async function main() {
  const existingMdPath = process.argv[2];
  const emailsJsonlPath = process.argv[3];
  const outputMdPath = process.argv[4];
  const additionalSourcePaths = process.argv.slice(5);

  if (!existingMdPath || !emailsJsonlPath || !outputMdPath) {
    console.error(
      "Usage: synthesize-project-knowledge <existing_md_path> <emails_jsonl_path> <output_md_path> [additional_source_md_path...]",
    );
    process.exit(2);
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    console.error("ANTHROPIC_API_KEY required.");
    process.exit(2);
  }

  console.log(`Loading email corpus from ${emailsJsonlPath}...`);
  const jsonlContent = await readFile(emailsJsonlPath, "utf-8");
  const emails = jsonlContent
    .split("\n")
    .filter((line) => line.trim().startsWith("{"))
    .map((line) => JSON.parse(line) as EmailRow);

  console.log(`Pulled ${String(emails.length)} email rows.`);

  const existingMd = await readFile(existingMdPath, "utf-8");
  console.log(`Existing markdown: ${String(existingMd.length)} chars.`);

  const corpusBlock = emails
    .map(
      (e, i) =>
        `--- email ${String(i + 1)} (${new Date(e.occurred_at).toISOString().slice(0, 10)}, alias=${e.alias ?? "unknown"}) ---\nSubject: ${e.subject ?? "(none)"}\n\n${e.body ?? ""}`,
    )
    .join("\n\n");

  console.log(
    `Corpus block: ${String(corpusBlock.length)} chars (~${String(Math.round(corpusBlock.length / 4))} tokens).`,
  );

  const additionalSourcesBlock = await Promise.all(
    additionalSourcePaths.map(async (path, i) => {
      const content = await readFile(path, "utf-8");
      return `<ADDITIONAL_SOURCE_${String(i + 1)} path="${path}">
${content}
</ADDITIONAL_SOURCE_${String(i + 1)}>`;
    }),
  );

  if (additionalSourcesBlock.length > 0) {
    console.log(`Loaded ${String(additionalSourcesBlock.length)} additional source(s).`);
  }

  const additionalSourcesNote =
    additionalSourcesBlock.length === 0
      ? ""
      : `

Here are ${String(additionalSourcesBlock.length)} additional source document(s) for this project (e.g., training course content, supplementary protocols). Integrate any unique facts from these into the appropriate sections of the AI Knowledge doc. Do not preserve them verbatim — overlap with the existing doc is expected and should be deduplicated. If the additional source contains a knowledge check / quiz, treat the quiz topics as a signal of what volunteers must know (and what the AI should be ready to support).

${additionalSourcesBlock.join("\n\n")}`;

  const userContent = `Here is the existing AI Knowledge document for the project:

<EXISTING_DOC>
${existingMd}
</EXISTING_DOC>${additionalSourcesNote}

Here is the corpus of ${String(emails.length)} past sent replies from this project's volunteer alias(es), most recent first:

<EMAIL_CORPUS>
${corpusBlock}
</EMAIL_CORPUS>

Produce the updated AI Knowledge document per the system instructions. Output ONLY the markdown.`;

  console.log(`Calling ${MODEL}...`);
  const startedAt = Date.now();

  const response = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: userContent,
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(
      `Anthropic API error ${String(response.status)} ${response.statusText}`,
    );
    console.error(error);
    process.exit(1);
  }

  const result = (await response.json()) as {
    readonly content: readonly { readonly type: string; readonly text?: string }[];
    readonly usage?: { readonly input_tokens: number; readonly output_tokens: number };
    readonly stop_reason: string;
  };

  const elapsedMs = Date.now() - startedAt;

  const text = result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");

  await writeFile(outputMdPath, text, "utf-8");

  console.log("");
  console.log(`Synthesis complete in ${(elapsedMs / 1000).toFixed(1)}s.`);
  console.log(`Stop reason: ${result.stop_reason}`);
  if (result.usage) {
    const inCost = (result.usage.input_tokens / 1_000_000) * 3;
    const outCost = (result.usage.output_tokens / 1_000_000) * 15;
    console.log(
      `Tokens: ${String(result.usage.input_tokens)} in, ${String(result.usage.output_tokens)} out. Estimated cost: $${(inCost + outCost).toFixed(3)}`,
    );
  }
  console.log(`Output written to: ${outputMdPath}`);
  console.log(`Output length: ${String(text.length)} chars`);
}

void main();
