import { appendSecurityAudit } from "./audit";

type AuditActorType = "system" | "user" | "worker" | "provider";

interface RateLimitBucket {
  count: number;
  resetAtMs: number;
}

interface GlobalRateLimitState {
  buckets: Map<string, RateLimitBucket>;
  sweepCount: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly resetAtMs: number;
  readonly retryAfterSeconds: number;
}

export interface IRateLimiter {
  consume(input: {
    readonly scope: string;
    readonly identifier: string;
    readonly limit: number;
    readonly windowMs: number;
    readonly nowMs?: number;
  }): Promise<RateLimitDecision>;
}

declare global {
  var __AS_COMMS_RATE_LIMIT_STATE__: GlobalRateLimitState | undefined;
}

const ONE_MINUTE_MS = 60_000;
const SWEEP_INTERVAL = 128;

function getGlobalRateLimitState(): GlobalRateLimitState {
  globalThis.__AS_COMMS_RATE_LIMIT_STATE__ ??= {
    buckets: new Map<string, RateLimitBucket>(),
    sweepCount: 0,
  };

  return globalThis.__AS_COMMS_RATE_LIMIT_STATE__;
}

function buildBucketKey(scope: string, identifier: string): string {
  return `${scope}:${identifier}`;
}

function toRetryAfterSeconds(resetAtMs: number, nowMs: number): number {
  return Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000));
}

export class InMemoryRateLimiter implements IRateLimiter {
  consume(input: {
    readonly scope: string;
    readonly identifier: string;
    readonly limit: number;
    readonly windowMs: number;
    readonly nowMs?: number;
  }): Promise<RateLimitDecision> {
    const state = getGlobalRateLimitState();
    const nowMs = input.nowMs ?? Date.now();
    const key = buildBucketKey(input.scope, input.identifier);
    const existingBucket = state.buckets.get(key);
    const bucket =
      existingBucket === undefined || existingBucket.resetAtMs <= nowMs
        ? {
            count: 0,
            resetAtMs: nowMs + input.windowMs,
          }
        : existingBucket;

    state.sweepCount += 1;
    if (state.sweepCount % SWEEP_INTERVAL === 0) {
      for (const [bucketKey, currentBucket] of state.buckets.entries()) {
        if (currentBucket.resetAtMs <= nowMs) {
          state.buckets.delete(bucketKey);
        }
      }
    }

    if (bucket.count >= input.limit) {
      state.buckets.set(key, bucket);

      return Promise.resolve({
        allowed: false,
        limit: input.limit,
        remaining: 0,
        resetAtMs: bucket.resetAtMs,
        retryAfterSeconds: toRetryAfterSeconds(bucket.resetAtMs, nowMs),
      });
    }

    bucket.count += 1;
    state.buckets.set(key, bucket);

    return Promise.resolve({
      allowed: true,
      limit: input.limit,
      remaining: Math.max(0, input.limit - bucket.count),
      resetAtMs: bucket.resetAtMs,
      retryAfterSeconds: 0,
    });
  }
}

let rateLimiterOverride: IRateLimiter | null = null;

export function getSecurityRateLimiter(): IRateLimiter {
  return rateLimiterOverride ?? new InMemoryRateLimiter();
}

export function setSecurityRateLimiterForTests(
  rateLimiter: IRateLimiter | null,
): void {
  rateLimiterOverride = rateLimiter;
}

export function resetSecurityRateLimiterForTests(): void {
  const state = getGlobalRateLimitState();
  state.buckets.clear();
  state.sweepCount = 0;
  rateLimiterOverride = null;
}

export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstForwardedIp = forwardedFor
      .split(",")
      .map((value) => value.trim())
      .find((value) => value.length > 0);

    if (firstForwardedIp) {
      return firstForwardedIp;
    }
  }

  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    "127.0.0.1"
  );
}

export async function enforceRateLimit(input: {
  readonly scope: string;
  readonly identifier: string;
  readonly limit: number;
  readonly windowMs?: number;
  readonly audit: {
    readonly actorType: AuditActorType;
    readonly actorId: string;
    readonly action: string;
    readonly entityType: string;
    readonly entityId: string;
    readonly metadataJson?: Readonly<Record<string, unknown>>;
    readonly policyCode?: string;
  };
}): Promise<RateLimitDecision> {
  const windowMs = input.windowMs ?? ONE_MINUTE_MS;
  const decision = await getSecurityRateLimiter().consume({
    scope: input.scope,
    identifier: input.identifier,
    limit: input.limit,
    windowMs,
  });

  if (!decision.allowed) {
    await appendSecurityAudit({
      actorType: input.audit.actorType,
      actorId: input.audit.actorId,
      action: input.audit.action,
      entityType: input.audit.entityType,
      entityId: input.audit.entityId,
      result: "denied",
      policyCode: input.audit.policyCode ?? "security.rate_limit",
      metadataJson: {
        reason: "rate_limit_exceeded",
        identifier: input.identifier,
        limit: input.limit,
        windowSeconds: Math.ceil(windowMs / 1000),
        retryAfterSeconds: decision.retryAfterSeconds,
        ...(input.audit.metadataJson ?? {}),
      },
    }).catch((error: unknown) => {
      console.error("Failed to append rate-limit audit.", error);
    });
  }

  return decision;
}
