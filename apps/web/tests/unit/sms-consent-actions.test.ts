import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reconcileSmsConsent } from "@as-comms/domain";

const requireSession = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({
  unstable_cache: (loader: () => unknown) => loader,
}));

vi.mock("@/src/server/auth/session", () => ({
  requireSession,
}));

import {
  getSmsConsentStatusAction,
  setSmsConsentAction,
} from "../../app/inbox/actions";
import {
  createInboxTestRuntime,
  seedInboxContact,
  type InboxTestRuntime,
} from "./inbox-stage1-helpers";

function buildCurrentUser() {
  const now = new Date("2026-08-03T14:00:00.000Z");
  return {
    id: "user:operator",
    name: "Operator User",
    email: "operator@example.org",
    emailVerified: now,
    image: null,
    role: "operator" as const,
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function seedCurrentUser(runtime: InboxTestRuntime) {
  await runtime.context.settings.users.upsert(buildCurrentUser());
}

async function seedContact(
  runtime: InboxTestRuntime,
  input: {
    readonly contactId: string;
    readonly phoneE164: string | null;
  },
) {
  await seedInboxContact(runtime.context, {
    contactId: input.contactId,
    salesforceContactId: null,
    displayName: input.contactId,
    primaryEmail: `${input.contactId}@example.org`,
    primaryPhone: input.phoneE164,
  });
}

async function insertConsent(
  runtime: InboxTestRuntime,
  input: {
    readonly id: string;
    readonly contactId: string | null;
    readonly phoneE164: string;
    readonly status: "opted_in" | "revoked";
    readonly createdAtIso: string;
    readonly source?: "operator_attestation" | "salesforce_field" | "sms_reply_yes";
    readonly sourceDetail?: string | null;
    readonly recordedByUserId?: string | null;
  },
) {
  const createdAt = new Date(input.createdAtIso);
  await runtime.context.repositories.consentRecords.insert({
    id: input.id,
    contactId: input.contactId,
    phoneE164: input.phoneE164,
    status: input.status,
    source: input.source ?? "operator_attestation",
    sourceDetail: input.sourceDetail ?? null,
    consentedAt: input.status === "opted_in" ? createdAt : null,
    revokedAt: input.status === "revoked" ? createdAt : null,
    recordedByUserId: input.recordedByUserId ?? "user:operator",
    notes: null,
    createdAt,
    updatedAt: createdAt,
  });
}

describe("SMS consent inbox actions", () => {
  let runtime: InboxTestRuntime | null = null;

  beforeEach(async () => {
    requireSession.mockReset();
    requireSession.mockResolvedValue(buildCurrentUser());
    runtime = await createInboxTestRuntime();
    await seedCurrentUser(runtime);
  });

  afterEach(async () => {
    await runtime?.dispose();
    runtime = null;
  });

  it("returns none when a contact has a phone but no consent rows", async () => {
    if (runtime === null) {
      throw new Error("runtime not initialized");
    }

    await seedContact(runtime, {
      contactId: "contact:none",
      phoneE164: "+15550000001",
    });

    const result = await getSmsConsentStatusAction({
      contactId: "contact:none",
    });

    expect(result).toEqual({
      ok: true,
      data: {
        phoneE164: "+15550000001",
        status: "none",
        changedAtIso: null,
      },
    });
  });

  it("returns the latest consent status by createdAt for a contact", async () => {
    if (runtime === null) {
      throw new Error("runtime not initialized");
    }

    await seedContact(runtime, {
      contactId: "contact:ordered",
      phoneE164: "+15550000002",
    });
    await insertConsent(runtime, {
      id: "consent-ordered-optin",
      contactId: "contact:ordered",
      phoneE164: "+15550000002",
      status: "opted_in",
      createdAtIso: "2026-08-03T14:00:00.000Z",
    });

    expect(
      await getSmsConsentStatusAction({ contactId: "contact:ordered" }),
    ).toEqual({
      ok: true,
      data: {
        phoneE164: "+15550000002",
        status: "opted_in",
        changedAtIso: "2026-08-03T14:00:00.000Z",
      },
    });

    await insertConsent(runtime, {
      id: "consent-ordered-revoked",
      contactId: "contact:ordered",
      phoneE164: "+15550000002",
      status: "revoked",
      createdAtIso: "2026-08-03T14:05:00.000Z",
      source: "salesforce_field",
      recordedByUserId: null,
    });

    expect(
      await getSmsConsentStatusAction({ contactId: "contact:ordered" }),
    ).toEqual({
      ok: true,
      data: {
        phoneE164: "+15550000002",
        status: "revoked",
        changedAtIso: "2026-08-03T14:05:00.000Z",
      },
    });
  });

  it("finds phone-only consent rows when the latest record is stored without a contact id", async () => {
    if (runtime === null) {
      throw new Error("runtime not initialized");
    }

    await seedContact(runtime, {
      contactId: "contact:phone-only",
      phoneE164: "+15550000003",
    });
    await insertConsent(runtime, {
      id: "consent-phone-only",
      contactId: null,
      phoneE164: "+15550000003",
      status: "opted_in",
      createdAtIso: "2026-08-03T14:10:00.000Z",
      source: "sms_reply_yes",
      recordedByUserId: null,
    });

    const result = await getSmsConsentStatusAction({
      contactId: "contact:phone-only",
    });

    expect(result).toEqual({
      ok: true,
      data: {
        phoneE164: "+15550000003",
        status: "opted_in",
        changedAtIso: "2026-08-03T14:10:00.000Z",
      },
    });
  });

  it("appends an operator opt-out from opted-in and records the operator metadata", async () => {
    if (runtime === null) {
      throw new Error("runtime not initialized");
    }

    await seedContact(runtime, {
      contactId: "contact:opt-out",
      phoneE164: "+15550000004",
    });
    await insertConsent(runtime, {
      id: "consent-existing-optin",
      contactId: "contact:opt-out",
      phoneE164: "+15550000004",
      status: "opted_in",
      createdAtIso: "2026-08-03T14:00:00.000Z",
    });

    const result = await setSmsConsentAction({
      contactId: "contact:opt-out",
      direction: "opt_out",
    });
    const latest = await runtime.context.repositories.consentRecords.findLatestByContact(
      "contact:opt-out",
    );

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({
      ok: true,
      data: {
        phoneE164: "+15550000004",
        status: "revoked",
      },
    });
    expect(latest).not.toBeNull();
    expect(latest).toMatchObject({
      contactId: "contact:opt-out",
      phoneE164: "+15550000004",
      status: "revoked",
      source: "operator_attestation",
      sourceDetail: "inbox_contact_rail",
      recordedByUserId: "user:operator",
      notes: "Recorded via inbox contact rail",
      consentedAt: null,
    });
    expect(latest?.revokedAt).toBeInstanceOf(Date);
  });

  it("allows operator opt-out even when there was previously no consent record", async () => {
    if (runtime === null) {
      throw new Error("runtime not initialized");
    }

    await seedContact(runtime, {
      contactId: "contact:no-prior-consent",
      phoneE164: "+15550000005",
    });

    const result = await setSmsConsentAction({
      contactId: "contact:no-prior-consent",
      direction: "opt_out",
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        phoneE164: "+15550000005",
        status: "revoked",
      },
    });
  });

  it("allows opt-in only when the current latest status is revoked", async () => {
    if (runtime === null) {
      throw new Error("runtime not initialized");
    }

    await seedContact(runtime, {
      contactId: "contact:revoked",
      phoneE164: "+15550000006",
    });
    await insertConsent(runtime, {
      id: "consent-revoked",
      contactId: "contact:revoked",
      phoneE164: "+15550000006",
      status: "revoked",
      createdAtIso: "2026-08-03T14:00:00.000Z",
    });

    expect(
      await setSmsConsentAction({
        contactId: "contact:revoked",
        direction: "opt_in",
      }),
    ).toMatchObject({
      ok: true,
      data: {
        phoneE164: "+15550000006",
        status: "opted_in",
      },
    });

    await seedContact(runtime, {
      contactId: "contact:none-fail",
      phoneE164: "+15550000007",
    });
    expect(
      await setSmsConsentAction({
        contactId: "contact:none-fail",
        direction: "opt_in",
      }),
    ).toEqual({
      ok: false,
      error: "opt_in_requires_prior_revocation",
    });

    await seedContact(runtime, {
      contactId: "contact:opted-in-fail",
      phoneE164: "+15550000008",
    });
    await insertConsent(runtime, {
      id: "consent-opted-in-fail",
      contactId: "contact:opted-in-fail",
      phoneE164: "+15550000008",
      status: "opted_in",
      createdAtIso: "2026-08-03T14:00:00.000Z",
    });
    expect(
      await setSmsConsentAction({
        contactId: "contact:opted-in-fail",
        direction: "opt_in",
      }),
    ).toEqual({
      ok: false,
      error: "opt_in_requires_prior_revocation",
    });
  });

  it("returns no_phone when the contact has no resolved phone", async () => {
    if (runtime === null) {
      throw new Error("runtime not initialized");
    }

    await seedContact(runtime, {
      contactId: "contact:no-phone",
      phoneE164: null,
    });

    expect(
      await getSmsConsentStatusAction({ contactId: "contact:no-phone" }),
    ).toEqual({
      ok: true,
      data: {
        phoneE164: null,
        status: "none",
        changedAtIso: null,
      },
    });
    expect(
      await setSmsConsentAction({
        contactId: "contact:no-phone",
        direction: "opt_out",
      }),
    ).toEqual({
      ok: false,
      error: "no_phone",
    });
  });

  it("returns unauthorized when the session is missing", async () => {
    requireSession.mockRejectedValueOnce(new Error("UNAUTHORIZED"));

    expect(
      await getSmsConsentStatusAction({ contactId: "contact:any" }),
    ).toEqual({
      ok: false,
      error: "unauthorized",
    });

    requireSession.mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    expect(
      await setSmsConsentAction({
        contactId: "contact:any",
        direction: "opt_out",
      }),
    ).toEqual({
      ok: false,
      error: "unauthorized",
    });
  });

  it("does not let Salesforce reconciliation clobber an operator revocation", async () => {
    if (runtime === null) {
      throw new Error("runtime not initialized");
    }

    await seedContact(runtime, {
      contactId: "contact:reconcile",
      phoneE164: "+15550000009",
    });

    await setSmsConsentAction({
      contactId: "contact:reconcile",
      direction: "opt_out",
    });
    const latest = await runtime.context.repositories.consentRecords.findLatestByContact(
      "contact:reconcile",
    );

    expect(
      reconcileSmsConsent({
        sfTextOptIn: true,
        latestConsent: latest,
      }),
    ).toEqual({ kind: "none" });
  });
});
