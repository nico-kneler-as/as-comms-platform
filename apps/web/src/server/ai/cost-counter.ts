interface DailyCostState {
  totalUsd: number;
  dayKey: string;
}

declare global {
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

