import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SMS_OPT_OUT_FOOTER,
  planSmsBroadcastFreeze,
  smsMetrics,
  type SmsBroadcastAudienceMember,
  type SmsBroadcastFreezeDeps,
  type SmsBroadcastLatestConsent,
} from "../src/index.js";

function member(
  overrides: Partial<SmsBroadcastAudienceMember> &
    Pick<SmsBroadcastAudienceMember, "contactId">,
): SmsBroadcastAudienceMember {
  return {
    firstName: "Ada",
    email: "ada@example.com",
    projectName: "Project Atlas",
    ...overrides,
  };
}

function consentMap(
  entries: readonly (readonly [string, SmsBroadcastLatestConsent])[],
): ReadonlyMap<string, SmsBroadcastLatestConsent> {
  return new Map(entries);
}

function createDeps(input?: {
  readonly audience?: readonly SmsBroadcastAudienceMember[];
  readonly consentByContactId?: ReadonlyMap<string, SmsBroadcastLatestConsent>;
  readonly senderId?: string;
  readonly additionalUnreachable?: Partial<
    NonNullable<SmsBroadcastFreezeDeps["additionalUnreachable"]>
  >;
  readonly optOutFooter?: string;
}) {
  const resolveAudience = vi.fn(() => Promise.resolve(input?.audience ?? []));
  const loadLatestConsentByContactIds = vi.fn((contactIds: readonly string[]) => {
    const consentByContactId =
      input?.consentByContactId ??
      new Map<string, SmsBroadcastLatestConsent>();

    return Promise.resolve(
      new Map<string, SmsBroadcastLatestConsent>(
        contactIds.flatMap((contactId) => {
          const consent = consentByContactId.get(contactId);
          return consent === undefined ? [] : [[contactId, consent] as const];
        }),
      ),
    );
  });
  const resolveActiveSmsSenderId = vi.fn(() =>
    Promise.resolve(input?.senderId ?? "sender-1"),
  );
  const deps: SmsBroadcastFreezeDeps = {
    resolveAudience,
    loadLatestConsentByContactIds,
    resolveActiveSmsSenderId,
    ...(input?.additionalUnreachable === undefined
      ? {}
      : { additionalUnreachable: input.additionalUnreachable }),
    ...(input?.optOutFooter !== undefined
      ? { optOutFooter: input.optOutFooter }
      : {}),
  };

  return {
    deps,
    resolveAudience,
    loadLatestConsentByContactIds,
    resolveActiveSmsSenderId,
  };
}

describe("planSmsBroadcastFreeze", () => {
  it("freezes one message per distinct opted-in phone and carries render metrics into the plan", async () => {
    const { deps } = createDeps({
      audience: [
        member({
          contactId: "contact-1",
          firstName: "Ada",
          email: "ada@example.com",
        }),
        member({
          contactId: "contact-2",
          firstName: "Grace",
          email: "grace@example.com",
        }),
        member({
          contactId: "contact-3",
          firstName: "Linus",
          email: "linus@example.com",
        }),
      ],
      consentByContactId: consentMap([
        [
          "contact-1",
          { status: "opted_in", phoneE164: "+14065550101" },
        ],
        [
          "contact-2",
          { status: "opted_in", phoneE164: "+14065550102" },
        ],
        [
          "contact-3",
          { status: "opted_in", phoneE164: "+14065550103" },
        ],
      ]),
      senderId: "sender-123",
    });

    const plan = await planSmsBroadcastFreeze({
      bodyTemplate: "Hi {{firstName}}, reply to {{email}}",
      deps,
    });

    const expectedBodies: [string, string, string] = [
      `Hi Ada, reply to ada@example.com\n\n${DEFAULT_SMS_OPT_OUT_FOOTER}`,
      `Hi Grace, reply to grace@example.com\n\n${DEFAULT_SMS_OPT_OUT_FOOTER}`,
      `Hi Linus, reply to linus@example.com\n\n${DEFAULT_SMS_OPT_OUT_FOOTER}`,
    ];

    expect(plan).toEqual({
      senderId: "sender-123",
      messages: [
        {
          contactId: "contact-1",
          phoneE164: "+14065550101",
          body: expectedBodies[0],
          segments: smsMetrics(expectedBodies[0]).segments,
          encoding: smsMetrics(expectedBodies[0]).encoding,
        },
        {
          contactId: "contact-2",
          phoneE164: "+14065550102",
          body: expectedBodies[1],
          segments: smsMetrics(expectedBodies[1]).segments,
          encoding: smsMetrics(expectedBodies[1]).encoding,
        },
        {
          contactId: "contact-3",
          phoneE164: "+14065550103",
          body: expectedBodies[2],
          segments: smsMetrics(expectedBodies[2]).segments,
          encoding: smsMetrics(expectedBodies[2]).encoding,
        },
      ],
      selectedContacts: 3,
      reachable: 3,
      deduplicatedByPhone: 0,
      frozen: 3,
      unreachable: {
        no_contact_match: 0,
        ambiguous_match: 0,
        no_consent: 0,
        revoked: 0,
        no_phone: 0,
      },
    });
  });

  it("deduplicates reachable recipients by shared phone, keeping the first contact", async () => {
    const { deps } = createDeps({
      audience: [
        member({ contactId: "contact-1", firstName: "Ada" }),
        member({ contactId: "contact-2", firstName: "Grace" }),
      ],
      consentByContactId: consentMap([
        [
          "contact-1",
          { status: "opted_in", phoneE164: "+14065550142" },
        ],
        [
          "contact-2",
          { status: "opted_in", phoneE164: "+14065550142" },
        ],
      ]),
    });

    const plan = await planSmsBroadcastFreeze({
      bodyTemplate: "Hi {{firstName}}",
      deps,
    });

    expect(plan.messages).toHaveLength(1);
    expect(plan.messages[0]).toMatchObject({
      contactId: "contact-1",
      phoneE164: "+14065550142",
      body: `Hi Ada\n\n${DEFAULT_SMS_OPT_OUT_FOOTER}`,
    });
    expect(plan.reachable).toBe(2);
    expect(plan.deduplicatedByPhone).toBe(1);
    expect(plan.frozen).toBe(1);
  });

  it("deduplicates the incoming audience by contactId before consent lookup and rendering", async () => {
    const { deps, loadLatestConsentByContactIds } = createDeps({
      audience: [
        member({
          contactId: "contact-1",
          firstName: "Ada",
          projectName: "Project Atlas",
        }),
        member({
          contactId: "contact-1",
          firstName: "Ignored Duplicate",
          projectName: "Project Borealis",
        }),
      ],
      consentByContactId: consentMap([
        [
          "contact-1",
          { status: "opted_in", phoneE164: "+14065550142" },
        ],
      ]),
    });

    const plan = await planSmsBroadcastFreeze({
      bodyTemplate: "Hi {{firstName}}",
      deps,
    });

    expect(loadLatestConsentByContactIds).toHaveBeenCalledWith(["contact-1"]);
    expect(plan.selectedContacts).toBe(1);
    expect(plan.messages).toHaveLength(1);
    expect(plan.messages[0]?.body).toBe(
      `Hi Ada\n\n${DEFAULT_SMS_OPT_OUT_FOOTER}`,
    );
  });

  it("passes revoked, missing-consent, and missing-phone contacts through unreachable counts and still resolves a sender", async () => {
    const { deps, resolveActiveSmsSenderId } = createDeps({
      audience: [
        member({ contactId: "contact-1" }),
        member({ contactId: "contact-2" }),
        member({ contactId: "contact-3" }),
      ],
      consentByContactId: consentMap([
        ["contact-1", { status: "revoked", phoneE164: "+14065550101" }],
        ["contact-3", { status: "opted_in", phoneE164: null }],
      ]),
      senderId: "sender-empty-run",
    });

    const plan = await planSmsBroadcastFreeze({
      bodyTemplate: "Hi {{firstName}}",
      deps,
    });

    expect(resolveActiveSmsSenderId).toHaveBeenCalledTimes(1);
    expect(plan.senderId).toBe("sender-empty-run");
    expect(plan.messages).toEqual([]);
    expect(plan.reachable).toBe(0);
    expect(plan.deduplicatedByPhone).toBe(0);
    expect(plan.unreachable).toEqual({
      no_contact_match: 0,
      ambiguous_match: 0,
      revoked: 1,
      no_consent: 1,
      no_phone: 1,
    });
    expect(plan.selectedContacts).toBe(3);
  });

  it("merges CSV-only drop buckets into the final freeze plan", async () => {
    const { deps } = createDeps({
      audience: [member({ contactId: "contact-1", firstName: "Ada" })],
      consentByContactId: consentMap([
        [
          "contact-1",
          { status: "opted_in", phoneE164: "+14065550101" },
        ],
      ]),
      additionalUnreachable: {
        no_contact_match: 2,
        ambiguous_match: 1,
      },
    });

    const plan = await planSmsBroadcastFreeze({
      bodyTemplate: "Hi {{firstName}}",
      deps,
    });

    expect(plan.selectedContacts).toBe(4);
    expect(plan.reachable).toBe(1);
    expect(plan.unreachable).toEqual({
      no_contact_match: 2,
      ambiguous_match: 1,
      no_consent: 0,
      revoked: 0,
      no_phone: 0,
    });
  });

  it.each([null, "   "])(
    "throws for an empty body template before calling any dependency: %p",
    async (bodyTemplate) => {
      const { deps, resolveAudience, loadLatestConsentByContactIds, resolveActiveSmsSenderId } =
        createDeps();

      await expect(
        planSmsBroadcastFreeze({
          bodyTemplate,
          deps,
        }),
      ).rejects.toThrow("SMS broadcast body is empty");

      expect(resolveAudience).not.toHaveBeenCalled();
      expect(loadLatestConsentByContactIds).not.toHaveBeenCalled();
      expect(resolveActiveSmsSenderId).not.toHaveBeenCalled();
    },
  );

  it("rejects when resolving the active SMS sender fails", async () => {
    const { deps } = createDeps({
      audience: [member({ contactId: "contact-1" })],
      consentByContactId: consentMap([
        [
          "contact-1",
          { status: "opted_in", phoneE164: "+14065550101" },
        ],
      ]),
    });

    const senderError = new Error("expected exactly one active sender");
    const rejectingDeps: SmsBroadcastFreezeDeps = {
      ...deps,
      resolveActiveSmsSenderId: vi.fn(() => Promise.reject(senderError)),
    };

    await expect(
      planSmsBroadcastFreeze({
        bodyTemplate: "Hi {{firstName}}",
        deps: rejectingDeps,
      }),
    ).rejects.toThrow(senderError);
  });

  it("uses a custom opt-out footer when provided", async () => {
    const { deps } = createDeps({
      audience: [
        member({ contactId: "contact-1", firstName: "Ada" }),
        member({ contactId: "contact-2", firstName: "Grace" }),
      ],
      consentByContactId: consentMap([
        [
          "contact-1",
          { status: "opted_in", phoneE164: "+14065550101" },
        ],
        [
          "contact-2",
          { status: "opted_in", phoneE164: "+14065550102" },
        ],
      ]),
      optOutFooter: "Txt STOP to quit",
    });

    const plan = await planSmsBroadcastFreeze({
      bodyTemplate: "Hi {{firstName}}",
      deps,
    });

    expect(plan.messages.map((message) => message.body)).toEqual([
      "Hi Ada\n\nTxt STOP to quit",
      "Hi Grace\n\nTxt STOP to quit",
    ]);
  });
});
