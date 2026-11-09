import { createHash } from "node:crypto";

import {
  verifyExpeditionWithdrawToken,
  type ExpeditionWithdrawTokenPayload,
} from "@as-comms/domain";

import type { Stage1WebRuntime } from "@/src/server/stage1-runtime";

export interface WithdrawPageModel {
  readonly state: "confirm" | "done" | "invalid";
  readonly token: string;
  readonly projectName: string;
}

function withdrawSecret(): string | null {
  const secret = process.env.EXPEDITION_WITHDRAW_LINK_SECRET?.trim() ?? "";
  return secret.length >= 32 ? secret : null;
}

export function resolveExpeditionWithdrawToken(
  token: string,
  now: Date = new Date(),
): ExpeditionWithdrawTokenPayload | null {
  const secret = withdrawSecret();
  return secret === null ? null : verifyExpeditionWithdrawToken(token, { secret, now });
}

export async function loadWithdrawPageModel(input: {
  readonly runtime: Stage1WebRuntime;
  readonly token: string;
  readonly done: boolean;
}): Promise<WithdrawPageModel> {
  const resolved = resolveExpeditionWithdrawToken(input.token);
  if (resolved === null) {
    return { state: "invalid", token: input.token, projectName: "this project" };
  }
  const project = await input.runtime.settings.projects.findById(resolved.projectId);
  const projectName = project?.projectName ?? "this project";
  return {
    state: input.done ? "done" : "confirm",
    token: input.token,
    projectName,
  };
}

export function hashWithdrawIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex");
}
