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
  /**
   * Process-local in-memory rate-limit buckets keyed by `${scope}:${identifier}`.
   * Lives on `globalThis` so the bucket map survives Next route module
   * reloads within a single Node process (HMR in dev; warm Lambda-style
   * reuse in prod). Scoped per-process: with horizontal scaling, each
   * Railway instance has its own bucket map and clients can shop limits
   * by hitting different instances.
   *
   * Intentional: pattern flagged as "hidden_state_mutation" by static
   * analysis but is a real cross-module cache, not a hidden side-effect.
   *
   * For per-IP/per-user limits this is acceptable on single-instance deploy.
   * If the web service ever scales horizontally, swap the InMemoryRateLimiter
   * for a Redis-backed implementation. The IRateLimiter interface below
   * exists so the swap is a one-line change in `getSecurityRateLimiter`.
   */
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

/**
 * Resolve the request's client IP for rate-limit bucketing.
 *
 * Trust order matters: an attacker can spoof headers they fully control.
 * Per Railway's edge-proxy documented behavior (verified 2026-05-02, see
 * `.STATE-2026-05-02-security-review-pass-2.md` H5 and the Railway
 * forum post on x-forwarded-for trust):
 *
 *   - `x-real-ip` is set by Railway's edge AND any client-supplied value
 *     is stripped before forwarding. Trustworthy.
 *   - `cf-connecting-ip` is set by Cloudflare's edge AND any client-supplied
 *     value is stripped. Trustworthy when Cloudflare fronts the deploy.
 *   - `x-forwarded-for` is APPENDED to by Railway with the actual client IP,
 *     but client-supplied entries are preserved at the LEFTMOST positions.
 *     The rightmost value is Railway's view of the client; the leftmost is
 *     attacker-controlled. Naive "take the first" implementations are
 *     spoofable for rate-limit evasion.
 *
 * Prefer the trustworthy headers; fall back to the rightmost X-Forwarded-For
 * value (Railway's edge entry) only when nothing else is available — this
 * is the right default for non-Railway dev environments where there's no
 * edge proxy adding a trusted header.
 *
 * In tests and local dev with no proxy headers, returns "127.0.0.1".
 */
export function getClientIp(request: Request): string {
  const cfConnectingIp = request.headers.get("cf-connecting-ip");
  if (cfConnectingIp && cfConnectingIp.trim().length > 0) {
    return cfConnectingIp.trim();
  }

  const xRealIp = request.headers.get("x-real-ip");
  if (xRealIp && xRealIp.trim().length > 0) {
    return xRealIp.trim();
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const chain = forwardedFor
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    // Take the rightmost entry — the trusted edge's view of the client.
    // The leftmost entries are client-controlled and can be spoofed.
    const trustedEdgeEntry = chain[chain.length - 1];
    if (trustedEdgeEntry !== undefined) {
      return trustedEdgeEntry;
    }
  }

  return "127.0.0.1";
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
