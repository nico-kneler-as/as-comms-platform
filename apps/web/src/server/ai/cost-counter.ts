interface DailyCostState {
  totalUsd: number;
  dayKey: string;
}

declare global {
  /**
   * Process-local daily cost accumulator for the AI draft surface. Lives on
   * `globalThis` so module reloads in dev (HMR) and shared module instances
   * across Next route boundaries observe the same accumulator within a
   * single Node process.
   *
   * Intentional: pattern flagged as "hidden_state_mutation" by static
   * analysis but is a real cross-module cache, not a hidden side-effect.
   *
   * Limitation: if the web service ever scales to multiple Railway
   * instances, each instance has its own counter, so the effective cap
   * becomes N × `AI_DAILY_CAP_USD`. Current deploy is single-instance;
   * if that changes, move this counter to a Redis or DB row. See
   * `.STATE-2026-05-02-security-review.md` M2.
   */
  var __AS_COMMS_AI_DAILY_COST_STATE__: DailyCostState | undefined;
}

function currentDayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function getState(now: Date = new Date()): DailyCostState {
  globalThis.__AS_COMMS_AI_DAILY_COST_STATE__ ??= {
    totalUsd: 0,
    dayKey: currentDayKey(now),
  };

  if (globalThis.__AS_COMMS_AI_DAILY_COST_STATE__.dayKey !== currentDayKey(now)) {
    globalThis.__AS_COMMS_AI_DAILY_COST_STATE__ = {
      totalUsd: 0,
      dayKey: currentDayKey(now),
    };
  }

  return globalThis.__AS_COMMS_AI_DAILY_COST_STATE__;
}

export function record(costUsd: number, now: Date = new Date()): void {
  const state = getState(now);
  state.totalUsd += costUsd;
}

export function isOverBudget(capUsd: number, now: Date = new Date()): boolean {
  return getState(now).totalUsd >= capUsd;
}

export function getDailyTotal(now: Date = new Date()): number {
  return getState(now).totalUsd;
}

export function resetForNewDay(now: Date = new Date()): void {
  globalThis.__AS_COMMS_AI_DAILY_COST_STATE__ = {
    totalUsd: 0,
    dayKey: currentDayKey(now),
  };
}

