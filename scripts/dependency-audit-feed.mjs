import { spawnSync } from "node:child_process";

const dependencyAuditSecretHeader = "x-as-comms-dependency-audit-secret";
const auditArgs = ["audit", "--audit-level", "high", "--json"];
const reportableSeverities = new Set(["high", "critical"]);

function readRequiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseGhsaId(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }

    const match = candidate.match(/GHSA-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}/);

    if (match) {
      return match[0].toUpperCase();
    }
  }

  return null;
}

function normalizePatchedRange(...candidates) {
  for (const candidate of candidates) {
    const text = normalizeString(candidate);

    if (text.length > 0) {
      return text;
    }
  }

  return "none available";
}

function inferDependencyTypeFromFindingPaths(paths) {
  if (!Array.isArray(paths)) {
    return null;
  }

  for (const path of paths) {
    if (typeof path !== "string") {
      continue;
    }

    if (path.split(">").length <= 1) {
      return "direct";
    }
  }

  return "transitive";
}

function inferDependencyType(advisory, fallback = "transitive") {
  if (advisory && typeof advisory === "object") {
    if (advisory.dependencyType === "direct") {
      return "direct";
    }

    if (advisory.dependencyType === "transitive") {
      return "transitive";
    }

    if (typeof advisory.isDirect === "boolean") {
      return advisory.isDirect ? "direct" : "transitive";
    }

    if (Array.isArray(advisory.findings)) {
      for (const finding of advisory.findings) {
        if (!finding || typeof finding !== "object") {
          continue;
        }

        const inferred = inferDependencyTypeFromFindingPaths(finding.paths);

        if (inferred !== null) {
          return inferred;
        }
      }
    }
  }

  return fallback;
}

function toNormalizedAdvisory(input) {
  const severity = normalizeString(input.severity).toLowerCase();

  if (!reportableSeverities.has(severity)) {
    return null;
  }

  const ghsaId = parseGhsaId(
    input.ghsaId,
    input.githubAdvisoryId,
    input.url,
    input.source,
  );
  const packageName = normalizeString(input.packageName);
  const vulnerableRange = normalizeString(input.vulnerableRange);
  const patchedRange = normalizePatchedRange(input.patchedRange);

  if (!ghsaId || !packageName || !vulnerableRange) {
    throw new Error(
      `Unable to normalize dependency advisory: ${JSON.stringify({
        ghsaId,
        packageName,
        vulnerableRange,
      })}`,
    );
  }

  return {
    ghsaId,
    packageName,
    severity,
    vulnerableRange,
    patchedRange,
    dependencyType: input.dependencyType,
  };
}

function extractLegacyAdvisories(report) {
  if (!report || typeof report !== "object" || report.advisories === null) {
    return [];
  }

  if (typeof report.advisories !== "object") {
    return [];
  }

  return Object.values(report.advisories).flatMap((advisory) => {
    if (!advisory || typeof advisory !== "object") {
      return [];
    }

    const normalized = toNormalizedAdvisory({
      ghsaId: advisory.github_advisory_id,
      packageName: advisory.module_name ?? advisory.name,
      severity: advisory.severity,
      vulnerableRange: advisory.vulnerable_versions ?? advisory.range,
      patchedRange: advisory.patched_versions,
      dependencyType: inferDependencyType(advisory),
      url: advisory.url,
      source: advisory.source,
    });

    return normalized === null ? [] : [normalized];
  });
}

function extractVulnerabilityAdvisories(report) {
  if (!report || typeof report !== "object" || report.vulnerabilities === null) {
    return [];
  }

  if (typeof report.vulnerabilities !== "object") {
    return [];
  }

  const advisories = [];

  for (const [packageName, vulnerability] of Object.entries(report.vulnerabilities)) {
    if (!vulnerability || typeof vulnerability !== "object") {
      continue;
    }

    const viaEntries = Array.isArray(vulnerability.via)
      ? vulnerability.via.filter(
          (entry) => entry && typeof entry === "object" && !Array.isArray(entry),
        )
      : [];

    for (const viaEntry of viaEntries) {
      const normalized = toNormalizedAdvisory({
        ghsaId: viaEntry.github_advisory_id,
        packageName,
        severity: viaEntry.severity ?? vulnerability.severity,
        vulnerableRange: viaEntry.range ?? vulnerability.range,
        patchedRange:
          viaEntry.patched_versions ??
          vulnerability.fixAvailable?.name ??
          vulnerability.fixAvailable?.version,
        dependencyType: inferDependencyType(
          viaEntry,
          vulnerability.isDirect === true ? "direct" : "transitive",
        ),
        url: viaEntry.url,
        source: viaEntry.source,
      });

      if (normalized !== null) {
        advisories.push(normalized);
      }
    }
  }

  return advisories;
}

function compareAdvisories(left, right) {
  const severityRank = {
    critical: 0,
    high: 1,
  };
  const severityDelta = severityRank[left.severity] - severityRank[right.severity];

  if (severityDelta !== 0) {
    return severityDelta;
  }

  const packageDelta = left.packageName.localeCompare(right.packageName);

  if (packageDelta !== 0) {
    return packageDelta;
  }

  return left.ghsaId.localeCompare(right.ghsaId);
}

function extractAuditReport(rawOutput) {
  for (const candidate of rawOutput) {
    const text = candidate.trim();

    if (!text) {
      continue;
    }

    try {
      return JSON.parse(text);
    } catch {
      continue;
    }
  }

  throw new Error("Unable to parse pnpm audit JSON output.");
}

function collectAdvisories(report) {
  const deduped = new Map();

  for (const advisory of [
    ...extractLegacyAdvisories(report),
    ...extractVulnerabilityAdvisories(report),
  ]) {
    deduped.set(`${advisory.ghsaId}:${advisory.packageName}`, advisory);
  }

  return [...deduped.values()].sort(compareAdvisories);
}

async function main() {
  const endpoint = readRequiredEnv("DEPENDENCY_AUDIT_FEED_URL");
  const secret = readRequiredEnv("DEPENDENCY_AUDIT_FEED_SECRET");
  const auditResult = spawnSync("pnpm", auditArgs, {
    encoding: "utf8",
  });

  if (auditResult.error) {
    throw auditResult.error;
  }

  const report = extractAuditReport([auditResult.stdout, auditResult.stderr]);
  const advisories = collectAdvisories(report);
  const exitStatus = auditResult.status ?? 1;

  if (exitStatus !== 0 && advisories.length === 0) {
    throw new Error(
      `pnpm audit exited with status ${String(exitStatus)} without any reportable advisories.`,
    );
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [dependencyAuditSecretHeader]: secret,
    },
    body: JSON.stringify({
      generatedAt: new Date().toISOString(),
      exitStatus,
      advisories,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Dependency audit summary POST failed with status ${String(response.status)}${detail ? `: ${detail}` : ""}.`,
    );
  }

  console.log(
    `Posted dependency audit summary (${String(advisories.length)} advisories, exit status ${String(exitStatus)}).`,
  );
}

await main();
