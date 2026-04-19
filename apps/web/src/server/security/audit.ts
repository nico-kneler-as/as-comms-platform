import { getStage1WebRuntime } from "../stage1-runtime";

type AuditActorType = "system" | "user" | "worker" | "provider";
type AuditResult = "allowed" | "denied" | "recorded";

interface SecurityAuditInput {
  readonly actorType: AuditActorType;
  readonly actorId: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly result: AuditResult;
  readonly policyCode: string;
  readonly metadataJson: Readonly<Record<string, unknown>>;
  readonly occurredAt?: Date;
}

interface SensitiveReadAuditInput {
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly metadataJson?: Readonly<Record<string, unknown>>;
  readonly policyCode?: string;
}

const DEFAULT_READ_AUDIT_POLICY = "security.read_audit";
const pendingAuditTasks = new Set<Promise<void>>();

function buildAuditId(input: SecurityAuditInput, occurredAt: Date): string {
  return [
    "audit",
    input.entityType,
    input.entityId,
    input.action,
    String(occurredAt.getTime()),
    crypto.randomUUID(),
  ].join(":");
}

function trackDetachedAudit(task: () => Promise<void>): void {
  const tracked = (async () => {
    try {
      await task();
    } catch (error) {
      console.error("Failed to append detached security audit.", error);
    }
  })();

  pendingAuditTasks.add(tracked);
  void tracked.finally(() => {
    pendingAuditTasks.delete(tracked);
  });
}

export async function appendSecurityAudit(
  input: SecurityAuditInput,
): Promise<void> {
  const runtime = await getStage1WebRuntime();
  const occurredAt = input.occurredAt ?? new Date();

  await runtime.repositories.auditEvidence.append({
    id: buildAuditId(input, occurredAt),
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    occurredAt: occurredAt.toISOString(),
    result: input.result,
    policyCode: input.policyCode,
    metadataJson: input.metadataJson,
  });
}

export function recordSensitiveReadDetached(
  input: SensitiveReadAuditInput & {
    readonly actorId: string;
  },
): void {
  trackDetachedAudit(async () => {
    await appendSecurityAudit({
      actorType: "user",
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      result: "recorded",
      policyCode: input.policyCode ?? DEFAULT_READ_AUDIT_POLICY,
      metadataJson: input.metadataJson ?? {},
    });
  });
}

export function recordSensitiveReadFromUserPromiseDetached(
  userPromise: Promise<{ readonly id: string } | null>,
  input: SensitiveReadAuditInput,
): void {
  trackDetachedAudit(async () => {
    const user = await userPromise;
    if (user === null) {
      return;
    }

    await appendSecurityAudit({
      actorType: "user",
      actorId: user.id,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      result: "recorded",
      policyCode: input.policyCode ?? DEFAULT_READ_AUDIT_POLICY,
      metadataJson: input.metadataJson ?? {},
    });
  });
}

export function recordSensitiveReadForCurrentUserDetached(
  input: SensitiveReadAuditInput,
): void {
  trackDetachedAudit(async () => {
    let getCurrentUser:
      | (() => Promise<{ readonly id: string } | null>)
      | undefined;

    try {
      ({ getCurrentUser } = await import("../auth/session"));
    } catch {
      return;
    }

    let user: { readonly id: string } | null;
    try {
      user = await getCurrentUser();
    } catch {
      return;
    }

    if (user === null) {
      return;
    }

    await appendSecurityAudit({
      actorType: "user",
      actorId: user.id,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      result: "recorded",
      policyCode: input.policyCode ?? DEFAULT_READ_AUDIT_POLICY,
      metadataJson: input.metadataJson ?? {},
    });
  });
}

export async function waitForPendingSecurityAuditTasksForTests(): Promise<void> {
  await Promise.allSettled([...pendingAuditTasks]);
}
