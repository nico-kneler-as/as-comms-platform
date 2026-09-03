#!/usr/bin/env tsx

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { and, eq, isNull } from "drizzle-orm";

import {
  closeDatabaseConnection,
  createDatabaseConnection,
  createTemplate,
  listTemplatesByProject,
  projectDimensions,
  type Stage1Database,
} from "@as-comms/db";

import {
  convertSalesforceHtmlToTipTap,
  type SalesforceDroppedLink,
  convertSalesforceSubject,
} from "./import-sf-flow-email-converter.js";

const METADATA_NAMESPACE = "http://soap.sforce.com/2006/04/metadata";
type AutomatedEmailKind = NonNullable<
  Parameters<typeof createTemplate>[1]["kind"]
>;

export const FLOW_PROJECTS = {
  pnw: { id: "a0tVK00000AeJqzYAF", name: "PNW Biodiversity" },
  orcas: { id: "a0tVK00000EG0jyYAD", name: "Killer Whales" },
  twbp: { id: "a0tVK00000BV3GDYA1", name: "Whitebark Pine" },
  beech: { id: "a0tVK00001QOYfOYAX", name: "Saving American Beech" },
  butternut: {
    id: "a0tVK00001QqBuPYAV",
    name: "Restoring Butternut, the host",
  },
} as const;

type XmlNode = {
  readonly name: string;
  readonly children: XmlChild[];
};
type XmlChild = XmlNode | { readonly text: string };

type FlowResource = {
  readonly value: string;
  readonly name: string;
};

type ParsedFlowAction = {
  readonly label: string;
  readonly exclusionText: string;
  readonly actionType: "emailSimple" | "emailAlert";
  readonly subject: string;
  readonly body: string;
  readonly subjectResourceName: string | null;
  readonly bodyResourceName: string | null;
  readonly unresolvableReferences: readonly string[];
};

export type ParsedSalesforceFlow = {
  readonly path: string;
  readonly label: string;
  readonly status: string | null;
  readonly actions: readonly ParsedFlowAction[];
};

export type FlowEmailRoute = {
  readonly projectId: string;
  readonly projectName: string;
};

export type FlowEmailImportTemplate = {
  readonly status: "would_create" | "created" | "skipped_existing";
  readonly projectId: string;
  readonly projectName: string;
  readonly name: string;
  readonly kind: AutomatedEmailKind;
  readonly sourceFlowLabel: string;
  readonly sourceActionLabel: string;
  readonly subjectResourceName: string | null;
  readonly bodyResourceName: string | null;
  readonly mappedFields: readonly string[];
  readonly unmappedPlaceholders: readonly string[];
  readonly unresolvableReferences: readonly string[];
  readonly flattenedHeadings: number;
  readonly droppedImages: number;
  /**
   * Links whose Salesforce href the renderer cannot accept (merge expressions
   * such as `{!$Record.Event_URL__c}`). The text survives, the destination
   * does not — someone has to re-add these by hand, so they are reported.
   */
  readonly droppedLinks: readonly SalesforceDroppedLink[];
};

export type FlowEmailImportSummary = {
  readonly apply: boolean;
  readonly flowFilesRead: number;
  readonly flowsIgnored: number;
  readonly templates: readonly FlowEmailImportTemplate[];
};

export type FlowEmailImportContext = {
  readonly db?: Stage1Database;
};

export type FlowEmailImportOptions = {
  readonly flows: readonly { readonly path: string; readonly xml: string }[];
  readonly apply: boolean;
  readonly projectId?: string;
};

// Scope decision (Nico, 2026-09-02): import EVERY volunteer-facing email a live
// project's flows fire (hex/ARU, events, NDA included) so each project mirrors
// reality. Only HR position flows and staff-only notifications are excluded.
const excludedPattern =
  /Rejection Schedule|Reminder TEST|Send Test Counter Email|New Distribution Location Alert/iu;

function decodeXmlEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/giu,
    (match, entity: string) => {
      const normalized = entity.toLowerCase();
      if (normalized === "amp") return "&";
      if (normalized === "lt") return "<";
      if (normalized === "gt") return ">";
      if (normalized === "quot") return '"';
      if (normalized === "apos") return "'";
      const codePoint = normalized.startsWith("#x")
        ? Number.parseInt(normalized.slice(2), 16)
        : Number.parseInt(normalized.slice(1), 10);
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
    },
  );
}

function localName(name: string): string {
  return name.includes(":") ? name.slice(name.lastIndexOf(":") + 1) : name;
}

function parseFlowXml(xml: string): XmlNode {
  const rootTag = /<(?:(?:\w+):)?Flow\b([^>]*)>/u.exec(xml)?.[1] ?? "";
  const namespacePattern = new RegExp(
    `xmlns(?::\\w+)?=["']${METADATA_NAMESPACE}["']`,
    "u",
  );
  if (!namespacePattern.test(rootTag)) {
    throw new Error(
      `Unsupported Salesforce flow XML namespace; expected ${METADATA_NAMESPACE}.`,
    );
  }
  const root: { name: string; children: XmlChild[] } = {
    name: "root",
    children: [],
  };
  const stack: { name: string; children: XmlChild[] }[] = [root];
  let cursor = 0;
  while (cursor < xml.length) {
    const open = xml.indexOf("<", cursor);
    if (open === -1) {
      const text = decodeXmlEntities(xml.slice(cursor));
      if (text) stack.at(-1)?.children.push({ text });
      break;
    }
    if (open > cursor) {
      const text = decodeXmlEntities(xml.slice(cursor, open));
      if (text) stack.at(-1)?.children.push({ text });
    }
    if (xml.startsWith("<![CDATA[", open)) {
      const end = xml.indexOf("]]>", open + 9);
      const text = xml.slice(open + 9, end === -1 ? xml.length : end);
      if (text) stack.at(-1)?.children.push({ text });
      cursor = end === -1 ? xml.length : end + 3;
      continue;
    }
    if (xml.startsWith("<!--", open)) {
      const end = xml.indexOf("-->", open + 4);
      cursor = end === -1 ? xml.length : end + 3;
      continue;
    }
    const end = xml.indexOf(">", open + 1);
    if (end === -1)
      throw new Error("Malformed Salesforce flow XML: unclosed tag.");
    const tag = xml.slice(open + 1, end).trim();
    cursor = end + 1;
    if (!tag || tag.startsWith("?") || tag.startsWith("!")) continue;
    if (tag.startsWith("/")) {
      stack.pop();
      continue;
    }
    const name = tag.split(/\s+/u)[0]?.replace(/\/$/u, "");
    if (!name) continue;
    const node = { name, children: [] as XmlChild[] };
    stack.at(-1)?.children.push(node);
    if (!tag.endsWith("/")) stack.push(node);
  }
  const flow = root.children.find(
    (child): child is XmlNode =>
      "name" in child && localName(child.name) === "Flow",
  );
  if (flow === undefined)
    throw new Error("Malformed Salesforce flow XML: missing Flow root.");
  return flow;
}

function childrenNamed(node: XmlNode, name: string): readonly XmlNode[] {
  return node.children.filter(
    (child): child is XmlNode =>
      "name" in child && localName(child.name) === name,
  );
}

function textContent(node: XmlNode): string {
  return node.children
    .map((child) => ("text" in child ? child.text : textContent(child)))
    .join("");
}

function childText(node: XmlNode, name: string): string | null {
  const child = childrenNamed(node, name)[0];
  return child === undefined ? null : textContent(child).trim();
}

function findDescendantText(node: XmlNode, name: string): string | null {
  const direct = childText(node, name);
  if (direct !== null) return direct;
  for (const child of node.children) {
    if ("name" in child) {
      const found = findDescendantText(child, name);
      if (found !== null) return found;
    }
  }
  return null;
}

function readResources(flow: XmlNode): ReadonlyMap<string, FlowResource> {
  const resources = new Map<string, FlowResource>();
  const configurations: readonly [string, string][] = [
    ["textTemplates", "text"],
    ["variables", "stringValue"],
    ["constants", "stringValue"],
    ["formulas", "expression"],
  ];
  for (const [elementName, valueName] of configurations) {
    for (const resource of childrenNamed(flow, elementName)) {
      const name = childText(resource, "name");
      const value = findDescendantText(resource, valueName);
      if (name !== null && value !== null) resources.set(name, { name, value });
    }
  }
  return resources;
}

function resolveInputValue(
  value: string | null,
  resources: ReadonlyMap<string, FlowResource>,
): {
  readonly value: string;
  readonly resourceName: string | null;
  readonly unresolved: string | null;
} {
  const rawValue = value ?? "";
  const reference = /^\s*(?:\{!([^}]+)\}|([A-Za-z_][A-Za-z0-9_]*))\s*$/u.exec(
    rawValue,
  );
  const referenceName = reference?.[1] ?? reference?.[2];
  if (referenceName === undefined) {
    return { value: rawValue, resourceName: null, unresolved: null };
  }
  const resource = resources.get(referenceName);
  if (resource === undefined) {
    return { value: rawValue, resourceName: null, unresolved: referenceName };
  }
  return {
    value: resource.value,
    resourceName: resource.name,
    unresolved: null,
  };
}

function inputParameterValue(
  action: XmlNode,
  parameterName: string,
): string | null {
  const parameter = childrenNamed(action, "inputParameters").find(
    (candidate) => childText(candidate, "name") === parameterName,
  );
  if (parameter === undefined) return null;
  const valueNode = childrenNamed(parameter, "value")[0];
  if (valueNode === undefined) return null;
  return (
    findDescendantText(valueNode, "stringValue") ??
    findDescendantText(valueNode, "elementReference")
  );
}

export function parseSalesforceFlowXml(input: {
  readonly path: string;
  readonly xml: string;
}): ParsedSalesforceFlow {
  const flow = parseFlowXml(input.xml);
  const label = childText(flow, "label") ?? path.basename(input.path);
  const resources = readResources(flow);
  const actions = childrenNamed(flow, "actionCalls")
    .map((action): ParsedFlowAction | null => {
      const actionType = childText(action, "actionType");
      if (actionType !== "emailSimple" && actionType !== "emailAlert")
        return null;
      const actionLabel =
        childText(action, "label") ??
        childText(action, "actionName") ??
        childText(action, "name") ??
        "Unnamed email action";
      const exclusionText = [
        childText(action, "label"),
        childText(action, "actionName"),
        childText(action, "name"),
      ]
        .filter((value): value is string => value !== null)
        .join(" ");
      const subject = resolveInputValue(
        inputParameterValue(action, "emailSubject"),
        resources,
      );
      const body = resolveInputValue(
        inputParameterValue(action, "emailBody"),
        resources,
      );
      return {
        label: actionLabel,
        exclusionText,
        actionType,
        subject: subject.value,
        body: body.value,
        subjectResourceName: subject.resourceName,
        bodyResourceName: body.resourceName,
        unresolvableReferences: [subject.unresolved, body.unresolved].filter(
          (value): value is string => value !== null,
        ),
      };
    })
    .filter((action): action is ParsedFlowAction => action !== null);
  return {
    path: input.path,
    label,
    status: childText(flow, "status"),
    actions,
  };
}

export function routeFlowEmail(
  flowLabel: string,
  actionLabel: string,
): FlowEmailRoute | null {
  const normalized = flowLabel.trim().toLowerCase();
  if (/^pnw(?:\s|$)|^pnw bio/u.test(normalized))
    return {
      projectId: FLOW_PROJECTS.pnw.id,
      projectName: FLOW_PROJECTS.pnw.name,
    };
  if (/^orcas(?:\s|$)/u.test(normalized))
    return {
      projectId: FLOW_PROJECTS.orcas.id,
      projectName: FLOW_PROJECTS.orcas.name,
    };
  if (/^twbp(?:\s|$)/u.test(normalized))
    return {
      projectId: FLOW_PROJECTS.twbp.id,
      projectName: FLOW_PROJECTS.twbp.name,
    };
  if (/^(?:b&b|beech(?: & butternut)?)(?:\s|$)/u.test(normalized)) {
    const action = actionLabel.toLowerCase();
    if (action.includes("beech") && !action.includes("butternut")) {
      return {
        projectId: FLOW_PROJECTS.beech.id,
        projectName: FLOW_PROJECTS.beech.name,
      };
    }
    return {
      projectId: FLOW_PROJECTS.butternut.id,
      projectName: FLOW_PROJECTS.butternut.name,
    };
  }
  return null;
}

export function humanizeFlowActionLabel(label: string): string {
  const stripped = label
    .replace(/^send\s+/iu, "")
    .replace(/\s+action\s+\d+\s*$/iu, "")
    .replace(/\s+email\s*$/iu, "")
    .replace(/\s+/gu, " ")
    .trim();
  const series = /^(.*?)(?:\s+)(\d+)$/u.exec(stripped);
  const normalized = series === null ? stripped : `${series[1]} #${series[2]}`;
  return normalized
    ? `${normalized.slice(0, 1).toUpperCase()}${normalized.slice(1).toLowerCase()}`
    : "Imported email";
}

const nonLifecycleFamilyPattern =
  /Event|RSVP|Hex|ARU|Retrieval|Trip Date Has Passed|Distribution|Cancell/iu;

export function guessAutomatedEmailKind(label: string): AutomatedEmailKind {
  const candidates: readonly [RegExp, AutomatedEmailKind][] = [
    [/Additional Info|Application Reminder|Finish Your/iu, "application_nudge"],
    [
      /Application Received|Confirmation Email|App Received/iu,
      "application_received",
    ],
    [/Accepted/iu, "accepted"],
    [/Denied/iu, "denied"],
    [/Training Reminder|Reminder \d/iu, "training_reminder"],
    [/Quiz Completion|Completed Email|Slack and Homepage/iu, "training_passed"],
    [/Trip Planning|Zoom/iu, "trip_planning"],
    [/Data Collection|Day Email|Day Reminder/iu, "data_reminder"],
    [/First Record/iu, "first_record"],
    [/Post Trip|Survey/iu, "post_trip"],
  ];
  return candidates.find(([pattern]) => pattern.test(label))?.[1] ?? "custom";
}

type PreparedTemplate = Omit<FlowEmailImportTemplate, "status"> & {
  readonly draftSubject: string;
  readonly draftDoc: unknown;
};

function prepareTemplates(
  parsedFlows: readonly ParsedSalesforceFlow[],
  projectId: string | undefined,
): {
  readonly templates: readonly PreparedTemplate[];
  readonly flowsIgnored: number;
} {
  const prepared: PreparedTemplate[] = [];
  let flowsIgnored = 0;
  for (const flow of parsedFlows) {
    if (
      flow.status?.toLowerCase() !== "active" ||
      excludedPattern.test(flow.label)
    ) {
      flowsIgnored += 1;
      continue;
    }
    let keptAction = false;
    for (const action of flow.actions) {
      if (excludedPattern.test(action.exclusionText)) continue;
      const route = routeFlowEmail(flow.label, action.label);
      if (
        route === null ||
        (projectId !== undefined && route.projectId !== projectId)
      )
        continue;
      keptAction = true;
      const body = convertSalesforceHtmlToTipTap(action.body);
      const subject = convertSalesforceSubject(action.subject);
      const unmappedPlaceholders = [
        ...new Set([
          ...body.unmappedPlaceholders,
          ...subject.unmappedPlaceholders,
        ]),
      ].sort((left, right) => left.localeCompare(right));
      const mappedFields = [
        "firstName",
        "lastName",
        "email",
        "projectName",
        "volunteerId",
        "esriUsername",
      ].filter(
        (key) =>
          JSON.stringify(body.doc).includes(`\"key\":\"${key}\"`) ||
          subject.subject.includes(`{{${key}}}`),
      );
      prepared.push({
        projectId: route.projectId,
        projectName: route.projectName,
        name: humanizeFlowActionLabel(action.label),
        // Event and hex/ARU logistics families are outside the standard
        // lifecycle checklist — imported faithfully, but always as `custom`.
        kind: nonLifecycleFamilyPattern.test(flow.label)
          ? "custom"
          : guessAutomatedEmailKind(action.label),
        sourceFlowLabel: flow.label,
        sourceActionLabel: action.label,
        subjectResourceName: action.subjectResourceName,
        bodyResourceName: action.bodyResourceName,
        mappedFields,
        unmappedPlaceholders,
        unresolvableReferences: action.unresolvableReferences,
        flattenedHeadings: body.flattenedHeadings,
        droppedImages: body.droppedImages,
        droppedLinks: body.droppedLinks,
        draftSubject: subject.subject,
        draftDoc: body.doc,
      });
    }
    if (!keptAction) flowsIgnored += 1;
  }
  const collisions = new Map<string, number>();
  for (const template of prepared) {
    const key = `${template.projectId}\u0000${template.name.toLocaleLowerCase()}`;
    collisions.set(key, (collisions.get(key) ?? 0) + 1);
  }
  return {
    templates: prepared.map((template) => {
      const key = `${template.projectId}\u0000${template.name.toLocaleLowerCase()}`;
      return (collisions.get(key) ?? 0) > 1
        ? {
            ...template,
            name: `${humanizeFlowActionLabel(template.sourceFlowLabel)} — ${template.name}`,
          }
        : template;
    }),
    flowsIgnored,
  };
}

export async function runFlowEmailImport(
  context: FlowEmailImportContext,
  options: FlowEmailImportOptions,
): Promise<FlowEmailImportSummary> {
  const parsedFlows = options.flows.map(parseSalesforceFlowXml);
  const prepared = prepareTemplates(parsedFlows, options.projectId);
  if (!options.apply) {
    return {
      apply: false,
      flowFilesRead: options.flows.length,
      flowsIgnored: prepared.flowsIgnored,
      templates: prepared.templates.map(
        ({
          draftDoc: _draftDoc,
          draftSubject: _draftSubject,
          ...template
        }) => ({
          ...template,
          status: "would_create",
        }),
      ),
    };
  }
  const db = context.db;
  if (db === undefined)
    throw new Error("DATABASE_URL is required when --apply is used.");
  const projectIds = [
    ...new Set(prepared.templates.map((template) => template.projectId)),
  ];
  const projectChecks = await Promise.all(
    projectIds.map(
      async (projectId) =>
        [
          projectId,
          (
            await db
              .select({ projectId: projectDimensions.projectId })
              .from(projectDimensions)
              .where(
                and(
                  eq(projectDimensions.projectId, projectId),
                  isNull(projectDimensions.salesforceDeletedAt),
                ),
              )
              .limit(1)
          )[0] ?? null,
        ] as const,
    ),
  );
  const missing = projectChecks
    .filter(([, project]) => project === null)
    .map(([projectId]) => projectId);
  if (missing.length > 0) {
    throw new Error(
      `Cannot import flow emails: platform project_id not found: ${missing.join(", ")}.`,
    );
  }
  const existingByProject = new Map<string, Set<string>>();
  for (const projectId of projectIds) {
    const templates = await listTemplatesByProject(db, projectId);
    existingByProject.set(
      projectId,
      new Set(templates.map((template) => template.name)),
    );
  }
  const templates: FlowEmailImportTemplate[] = [];
  for (const template of prepared.templates) {
    const existingNames = existingByProject.get(template.projectId);
    if (existingNames?.has(template.name)) {
      const {
        draftDoc: _draftDoc,
        draftSubject: _draftSubject,
        ...report
      } = template;
      templates.push({ ...report, status: "skipped_existing" });
      continue;
    }
    await createTemplate(db, {
      projectId: template.projectId,
      kind: template.kind,
      name: template.name,
      draftSubject: template.draftSubject,
      draftDoc: template.draftDoc,
      createdBy: null,
    });
    existingNames?.add(template.name);
    const {
      draftDoc: _draftDoc,
      draftSubject: _draftSubject,
      ...report
    } = template;
    templates.push({ ...report, status: "created" });
  }
  return {
    apply: true,
    flowFilesRead: options.flows.length,
    flowsIgnored: prepared.flowsIgnored,
    templates,
  };
}

export function renderFlowEmailImportSummary(
  summary: FlowEmailImportSummary,
): string {
  const projectSummary = new Map<
    string,
    { readonly name: string; created: number; skipped: number; planned: number }
  >();
  for (const template of summary.templates) {
    const current = projectSummary.get(template.projectId) ?? {
      name: template.projectName,
      created: 0,
      skipped: 0,
      planned: 0,
    };
    if (template.status === "created") current.created += 1;
    else if (template.status === "skipped_existing") current.skipped += 1;
    else current.planned += 1;
    projectSummary.set(template.projectId, current);
  }
  return [
    "# Salesforce flow email import",
    "",
    `Mode: ${summary.apply ? "apply" : "dry-run"}`,
    `Flow files read: ${summary.flowFilesRead}; ignored flows: ${summary.flowsIgnored}`,
    "",
    "## Projects",
    ...[...projectSummary.entries()].map(
      ([id, item]) =>
        `- ${item.name} (${id}): created=${item.created}, skipped=${item.skipped}, planned=${item.planned}`,
    ),
    "",
    "## Templates",
    ...summary.templates.map((template) =>
      [
        `- [${template.status}] ${template.projectName}: ${template.name} (${template.kind})`,
        `  mapped=${template.mappedFields.join(", ") || "none"}; unmapped=${template.unmappedPlaceholders.join(", ") || "none"}; flattened_headings=${template.flattenedHeadings}; dropped_images=${template.droppedImages}`,
        `  flow=${template.sourceFlowLabel}; action=${template.sourceActionLabel}; subject_resource=${template.subjectResourceName ?? "none"}; body_resource=${template.bodyResourceName ?? "none"}; unresolvable=${template.unresolvableReferences.join(", ") || "none"}`,
        ...template.droppedLinks.map(
          (link) =>
            `  dropped_link: "${link.text}" -> ${link.href} (re-add the destination by hand)`,
        ),
      ].join("\n"),
    ),
  ].join("\n");
}

async function listFlowFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listFlowFiles(entryPath);
      return entry.isFile() && entry.name.endsWith(".flow-meta.xml")
        ? [entryPath]
        : [];
    }),
  );
  return nested.flat().sort((left, right) => left.localeCompare(right));
}

function parseCommandOptions(args: readonly string[]): {
  readonly flowsDirectory: string;
  readonly apply: boolean;
  readonly projectId?: string;
} {
  const { values } = parseArgs({
    args,
    options: {
      flows: { type: "string" },
      apply: { type: "boolean", default: false },
      project: { type: "string" },
    },
    allowPositionals: false,
  });
  if (values.flows === undefined || !values.flows.trim())
    throw new Error("--flows <dir> is required.");
  return {
    flowsDirectory: values.flows,
    apply: values.apply ?? false,
    projectId: values.project,
  };
}

export async function main(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<FlowEmailImportSummary> {
  const command = parseCommandOptions(args);
  const paths = await listFlowFiles(command.flowsDirectory);
  const flows = await Promise.all(
    paths.map(async (flowPath) => ({
      path: flowPath,
      xml: await readFile(flowPath, "utf8"),
    })),
  );
  if (!command.apply) {
    const summary = await runFlowEmailImport(
      {},
      { flows, apply: false, projectId: command.projectId },
    );
    console.log(renderFlowEmailImportSummary(summary));
    return summary;
  }
  const connectionString = env.DATABASE_URL?.trim();
  if (!connectionString)
    throw new Error("DATABASE_URL is required when --apply is used.");
  const connection = createDatabaseConnection({ connectionString });
  try {
    const summary = await runFlowEmailImport(
      { db: connection.db },
      { flows, apply: true, projectId: command.projectId },
    );
    console.log(renderFlowEmailImportSummary(summary));
    return summary;
  } finally {
    await closeDatabaseConnection(connection);
  }
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  void main(process.argv.slice(2), process.env).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
