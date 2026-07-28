import type { DailyOpsDigest } from "./types.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function renderSectionLink(input: {
  readonly target: "logs" | "integrations";
  readonly settingsLogsUrl: string;
  readonly settingsIntegrationsUrl: string;
}) {
  return input.target === "logs"
    ? {
        label: "Settings → Logs",
        url: input.settingsLogsUrl,
      }
    : {
        label: "Settings → Integrations",
        url: input.settingsIntegrationsUrl,
      };
}

export function renderDailyOpsDigest(input: {
  readonly digest: DailyOpsDigest;
  readonly settingsLogsUrl: string;
  readonly settingsIntegrationsUrl: string;
}) {
  const subject =
    input.digest.kind === "all_quiet"
      ? "[AS Comms] Daily ops digest — all quiet for 7 days"
      : `[AS Comms] Daily ops digest — ${input.digest.summary}`;

  const bodyPlaintextLines = [
    `Daily ops digest for ${input.digest.window.labelDateDenver} (${input.digest.window.timeZone})`,
    `Window: ${input.digest.window.startsAt} to ${input.digest.window.endsAt}`,
    `Run at: ${input.digest.runAt}`,
    "",
    input.digest.summary,
  ];

  const bodyHtmlParts = [
    `<p><strong>Daily ops digest for ${escapeHtml(
      input.digest.window.labelDateDenver,
    )} (${escapeHtml(input.digest.window.timeZone)})</strong><br />Window: ${escapeHtml(
      input.digest.window.startsAt,
    )} to ${escapeHtml(input.digest.window.endsAt)}<br />Run at: ${escapeHtml(
      input.digest.runAt,
    )}</p>`,
    `<p>${escapeHtml(input.digest.summary)}</p>`,
  ];

  for (const section of input.digest.sections) {
    const link = renderSectionLink({
      target: section.linkTarget,
      settingsLogsUrl: input.settingsLogsUrl,
      settingsIntegrationsUrl: input.settingsIntegrationsUrl,
    });

    bodyPlaintextLines.push(
      "",
      section.title,
      section.summary,
      ...(section.baseline === null ? [] : [`Baseline: ${section.baseline}`]),
      ...section.details.map((detail) => `${detail.label}: ${detail.value}`),
      `${link.label}: ${link.url}`,
    );

    bodyHtmlParts.push(
      `<h2>${escapeHtml(section.title)}</h2>`,
      `<p>${escapeHtml(section.summary)}</p>`,
      ...(section.baseline === null
        ? []
        : [`<p><strong>Baseline:</strong> ${escapeHtml(section.baseline)}</p>`]),
      `<dl>${section.details
        .map(
          (detail) =>
            `<dt>${escapeHtml(detail.label)}</dt><dd>${escapeHtml(
              detail.value,
            )}</dd>`,
        )
        .join("")}</dl>`,
      `<p><a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a></p>`,
    );
  }

  if (input.digest.sections.length === 0) {
    bodyPlaintextLines.push(
      "",
      `Settings → Logs: ${input.settingsLogsUrl}`,
      `Settings → Integrations: ${input.settingsIntegrationsUrl}`,
    );
    bodyHtmlParts.push(
      `<p><a href="${escapeHtml(input.settingsLogsUrl)}">Settings → Logs</a></p>`,
      `<p><a href="${escapeHtml(
        input.settingsIntegrationsUrl,
      )}">Settings → Integrations</a></p>`,
    );
  }

  return {
    subject,
    bodyPlaintext: bodyPlaintextLines.join("\n"),
    bodyHtml: bodyHtmlParts.join(""),
  };
}
