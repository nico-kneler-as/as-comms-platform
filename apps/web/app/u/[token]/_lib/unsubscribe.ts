import { createHmac, timingSafeEqual } from "node:crypto";

import type { CampaignKind, ContactConsentRecord } from "@as-comms/contracts";
import { createConsentLedger } from "@as-comms/domain";

import type { Stage1WebRuntime } from "@/src/server/stage1-runtime";

export interface UnsubscribePageModel {
  readonly state: "pending" | "success" | "invalid";
  readonly token: string;
  readonly variant: "project" | "newsletter";
  readonly headline: string;
  readonly body: string;
  readonly email: string | null;
  readonly ctaPrompt: string | null;
  readonly ctaLabel: string | null;
  readonly showAllBanner: boolean;
  readonly showAllCta: boolean;
  readonly footerAddress: string | null;
}

interface ResolvedProjectScope {
  readonly id: string | null;
  readonly name: string | null;
}

export interface UnsubscribeTarget {
  readonly contactId: string | null;
  readonly newsletterSubscriberId: string | null;
  readonly email: string;
  readonly runId: string;
  readonly kind: CampaignKind;
  readonly project: ResolvedProjectScope;
}

const DIRECT_NEWSLETTER_TOKEN_PREFIX = "ns";

function readDirectNewsletterTokenSecret(): string {
  const configured = process.env.AUTH_SECRET?.trim();
  if (configured && configured.length > 0) {
    return configured;
  }

  if (process.env.NODE_ENV !== "production") {
    return "dev-newsletter-unsubscribe-secret";
  }

  throw new Error("AUTH_SECRET is required for newsletter unsubscribe links.");
}

function signDirectNewsletterToken(newsletterSubscriberId: string): string {
  return createHmac("sha256", readDirectNewsletterTokenSecret())
    .update(`newsletter-subscriber:${newsletterSubscriberId}`)
    .digest("base64url");
}

function parseDirectNewsletterToken(
  token: string,
): { readonly newsletterSubscriberId: string } | null {
  const [prefix, newsletterSubscriberId, signature, extra] = token.split(".");

  if (
    prefix !== DIRECT_NEWSLETTER_TOKEN_PREFIX ||
    newsletterSubscriberId === undefined ||
    signature === undefined ||
    extra !== undefined ||
    newsletterSubscriberId.trim().length === 0 ||
    signature.trim().length === 0
  ) {
    return null;
  }

  let expectedSignature: string;

  try {
    expectedSignature = signDirectNewsletterToken(newsletterSubscriberId);
  } catch {
    return null;
  }

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  return { newsletterSubscriberId };
}

async function resolveDirectNewsletterUnsubscribeTarget(
  runtime: Stage1WebRuntime,
  token: string,
): Promise<UnsubscribeTarget | null> {
  const parsed = parseDirectNewsletterToken(token);
  if (parsed === null) {
    return null;
  }

  const subscriber = await runtime.campaigns.newsletterSubscribers.findById(
    parsed.newsletterSubscriberId,
  );
  if (subscriber === null) {
    return null;
  }

  return {
    contactId: null,
    newsletterSubscriberId: subscriber.id,
    email: subscriber.email,
    runId: `newsletter-subscriber:${subscriber.id}`,
    kind: "newsletter",
    project: { id: null, name: null },
  };
}

export function createDirectNewsletterUnsubscribeToken(
  newsletterSubscriberId: string,
): string {
  return [
    DIRECT_NEWSLETTER_TOKEN_PREFIX,
    newsletterSubscriberId,
    signDirectNewsletterToken(newsletterSubscriberId),
  ].join(".");
}

function formatAddress(input: Awaited<ReturnType<Stage1WebRuntime["campaigns"]["orgSettings"]["read"]>>): string | null {
  const line1 = input.physicalAddressLine1.trim();
  const line2 = input.physicalAddressLine2.trim();
  const city = input.physicalCity.trim();
  const state = input.physicalState.trim();
  const zip = input.physicalZip.trim();
  const country = input.physicalCountry.trim();
  const cityLine = [city, state, zip].filter((part) => part.length > 0).join(", ");
  const parts = [line1, line2, cityLine, country].filter((part) => part.length > 0);
  return parts.length === 0 ? null : parts.join(" • ");
}

function buildInvalidModel(token: string, footerAddress: string | null): UnsubscribePageModel {
  return {
    state: "invalid",
    token,
    variant: "project",
    headline: "We couldn't find this unsubscribe link.",
    body:
      "If you want to unsubscribe, contact info@adventurescientists.org.",
    email: null,
    ctaPrompt: null,
    ctaLabel: null,
    showAllBanner: false,
    showAllCta: false,
    footerAddress,
  };
}

async function resolveProjectScope(
  runtime: Stage1WebRuntime,
  projectId: string | null,
  fallbackName: string | null,
): Promise<ResolvedProjectScope> {
  if (projectId === null) {
    return {
      id: null,
      name: fallbackName,
    };
  }

  const project = await runtime.settings.projects.findById(projectId);
  const hostProjectId = project?.connectedToProjectId ?? projectId;
  const effective = hostProjectId === projectId
    ? project
    : await runtime.settings.projects.findById(hostProjectId);

  return {
    id: hostProjectId,
    name: effective?.projectName ?? project?.projectName ?? fallbackName,
  };
}

export async function resolveUnsubscribeTarget(
  runtime: Stage1WebRuntime,
  token: string,
): Promise<UnsubscribeTarget | null> {
  const snapshot = await runtime.campaigns.audienceSnapshots.findByUnsubscribeToken(
    token,
  );
  if (snapshot === null) {
    return resolveDirectNewsletterUnsubscribeTarget(runtime, token);
  }

  const run = await runtime.campaigns.campaignRuns.findById(snapshot.campaignRunId);
  if (run === null) {
    return null;
  }

  return {
    contactId: snapshot.contactId,
    newsletterSubscriberId: snapshot.newsletterSubscriberId,
    email: snapshot.frozenEmail,
    runId: run.id,
    kind: run.kind,
    project:
      run.kind === "project"
        ? await resolveProjectScope(
            runtime,
            snapshot.frozenProjectId ?? run.projectId ?? null,
            snapshot.frozenProjectName,
          )
        : { id: null, name: null },
  };
}

function hasAllOptOut(records: readonly ContactConsentRecord[]): boolean {
  return records.some((record) => record.scopeType === "all");
}

function hasScopeOptOut(
  records: readonly ContactConsentRecord[],
  scope: { readonly type: "project" | "newsletter"; readonly id?: string },
): boolean {
  if (scope.type === "newsletter") {
    return records.some((record) => record.scopeType === "newsletter");
  }
  return records.some(
    (record) => record.scopeType === "project" && record.scopeId === scope.id,
  );
}

export interface UnsubscribeScope {
  readonly type: "project" | "newsletter";
  readonly id?: string;
}

export function resolveUnsubscribeScope(
  target: UnsubscribeTarget,
): UnsubscribeScope | null {
  if (target.kind === "newsletter") {
    return { type: "newsletter" };
  }
  const projectId = target.project.id;
  if (projectId === null) {
    return null;
  }
  return { type: "project", id: projectId };
}

export async function loadUnsubscribePageModel(input: {
  readonly runtime: Stage1WebRuntime;
  readonly token: string;
  readonly requestedAllBanner: boolean;
  readonly confirmed: boolean;
}): Promise<UnsubscribePageModel> {
  const footerAddress = formatAddress(await input.runtime.campaigns.orgSettings.read());
  const target = await resolveUnsubscribeTarget(input.runtime, input.token);

  if (target === null) {
    return buildInvalidModel(input.token, footerAddress);
  }

  if (target.kind === "project" && target.project.id === null) {
    return buildInvalidModel(input.token, footerAddress);
  }
  if (target.contactId === null && target.kind !== "newsletter") {
    return buildInvalidModel(input.token, footerAddress);
  }

  const scope = resolveUnsubscribeScope(target);
  if (scope === null) {
    return buildInvalidModel(input.token, footerAddress);
  }

  const consentRows =
    target.contactId === null
      ? []
      : await createConsentLedger({
          repositories: input.runtime.campaigns,
        }).listForContact(target.contactId);
  const newsletterSuppression =
    target.kind === "newsletter" && target.contactId === null
      ? await input.runtime.campaigns.newsletterSuppressions.findByEmail(
          target.email,
        )
      : null;
  const allOptedOut = hasAllOptOut(consentRows);
  const alreadyOptedOut =
    target.kind === "newsletter" && target.contactId === null
      ? newsletterSuppression !== null
      : allOptedOut || hasScopeOptOut(consentRows, scope);
  const isSuccess = input.confirmed || alreadyOptedOut;

  if (target.kind === "newsletter") {
    if (!isSuccess) {
      return {
        state: "pending",
        token: input.token,
        variant: "newsletter",
        headline: "Unsubscribe from the AS newsletter?",
        body:
          "Click confirm to stop receiving the monthly Adventure Scientists newsletter. Project-specific emails will keep coming if you're an active volunteer.",
        email: target.email,
        ctaPrompt: null,
        ctaLabel: null,
        showAllBanner: false,
        showAllCta: false,
        footerAddress,
      };
    }
    return {
      state: "success",
      token: input.token,
      variant: "newsletter",
      headline: "You've been unsubscribed from the AS newsletter.",
      body:
        "You won't receive the monthly Adventure Scientists newsletter anymore. If you're an active volunteer, project-specific emails will keep coming.",
      email: target.email,
      ctaPrompt:
        "Want to stop every Adventure Scientists email — project updates included?",
      ctaLabel: "Unsubscribe from all AS emails →",
      showAllBanner: input.requestedAllBanner && allOptedOut,
      showAllCta: !allOptedOut,
      footerAddress,
    };
  }

  const projectName = target.project.name ?? "this project";
  if (!isSuccess) {
    return {
      state: "pending",
      token: input.token,
      variant: "project",
      headline: `Unsubscribe from ${projectName} emails?`,
      body:
        "Click confirm to stop receiving campaign emails from this project. Your project-team correspondence — replies to direct conversations, trip logistics, gear pickups — will keep flowing as usual.",
      email: target.email,
      ctaPrompt: null,
      ctaLabel: null,
      showAllBanner: false,
      showAllCta: false,
      footerAddress,
    };
  }
  return {
    state: "success",
    token: input.token,
    variant: "project",
    headline: `You've been unsubscribed from ${projectName} emails.`,
    body:
      "You won't receive any more broadcast emails from this project. Your project-team correspondence — replies to direct conversations, trip logistics, gear pickups — will keep flowing as usual.",
    email: target.email,
    ctaPrompt:
      "Want to unsubscribe from all Adventure Scientists emails instead?",
    ctaLabel: "Unsubscribe from all AS emails →",
    showAllBanner: input.requestedAllBanner && allOptedOut,
    showAllCta: !allOptedOut,
    footerAddress,
  };
}
