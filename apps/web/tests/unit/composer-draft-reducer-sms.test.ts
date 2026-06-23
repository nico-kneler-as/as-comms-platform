import { describe, expect, it } from "vitest";

import {
  INITIAL_COMPOSER_DRAFT_STATE,
  reduceComposerDraft,
} from "../../app/inbox/_hooks/composer-draft-reducer";

describe("composer draft reducer sms", () => {
  it("stores sms recipient and allowed consent", () => {
    const state = reduceComposerDraft(INITIAL_COMPOSER_DRAFT_STATE, {
      type: "SET_SMS_RECIPIENT",
      recipient: {
        kind: "contact",
        contactId: "contact-1",
        displayName: "Maya Lee",
        phoneE164: "+14065550123",
      },
      consent: {
        canSend: true,
        reason: null,
      },
    });

    expect(state.smsRecipient).toEqual({
      kind: "contact",
      contactId: "contact-1",
      displayName: "Maya Lee",
      phoneE164: "+14065550123",
    });
    expect(state.smsConsent).toEqual({
      canSend: true,
      reason: null,
    });
  });

  it("stores sms recipient and denied consent", () => {
    const state = reduceComposerDraft(INITIAL_COMPOSER_DRAFT_STATE, {
      type: "SET_SMS_RECIPIENT",
      recipient: {
        kind: "phone",
        phoneE164: "+14065550124",
      },
      consent: {
        canSend: false,
        reason: "revoked",
      },
    });

    expect(state.smsRecipient).toEqual({
      kind: "phone",
      phoneE164: "+14065550124",
    });
    expect(state.smsConsent).toEqual({
      canSend: false,
      reason: "revoked",
    });
  });

  it("updates sms body", () => {
    const state = reduceComposerDraft(INITIAL_COMPOSER_DRAFT_STATE, {
      type: "SET_SMS_BODY",
      body: "Checking in about your field dates.",
    });

    expect(state.smsBody).toBe("Checking in about your field dates.");
  });

  it("sets sms sender", () => {
    const state = reduceComposerDraft(INITIAL_COMPOSER_DRAFT_STATE, {
      type: "SET_SMS_SENDER",
      senderId: "sender-1",
    });

    expect(state.smsSelectedSenderId).toBe("sender-1");
  });

  it("preselects the active sender when reply mode opens on sms", () => {
    const replyContext = {
      contactId: "contact-1",
      contactDisplayName: "Maya Lee",
      contactPrimaryPhone: "+14065550123",
      defaultChannel: "sms" as const,
      subject: "",
      threadCursor: null,
      threadId: null,
      inReplyToRfc822: null,
      defaultAlias: null,
      cc: [],
    };
    const state = reduceComposerDraft(INITIAL_COMPOSER_DRAFT_STATE, {
      type: "RESET_TO_PANE_MODE",
      composerPane: {
        mode: "replying",
        initialTab: "sms",
        replyContext,
      },
      replyContext,
      forwardContext: null,
      smsSenders: [
        {
          id: "sender-1",
          phoneE164: "+14062891988",
          displayName: "Adventure Scientists",
        },
      ],
    });

    expect(state.activeTab).toBe("sms");
    expect(state.smsSelectedSenderId).toBe("sender-1");
  });

  it("keeps the sms sender empty when no active sender exists", () => {
    const state = reduceComposerDraft(INITIAL_COMPOSER_DRAFT_STATE, {
      type: "SET_ACTIVE_TAB",
      tab: "sms",
      smsSenders: [],
    });

    expect(state.activeTab).toBe("sms");
    expect(state.smsSelectedSenderId).toBeNull();
  });

  it("clears errors when switching from email to sms to note", () => {
    const withErrors = reduceComposerDraft(INITIAL_COMPOSER_DRAFT_STATE, {
      type: "SET_ERRORS",
      inlineError: {
        message: "Bad field",
        retryable: false,
      },
      fieldErrors: [{ field: "body", message: "required" }],
    });
    const sms = reduceComposerDraft(withErrors, {
      type: "SET_ACTIVE_TAB",
      tab: "sms",
      smsSenders: [],
    });
    const note = reduceComposerDraft(
      {
        ...sms,
        inlineError: {
          message: "Another error",
          retryable: false,
        },
        fieldErrors: [{ field: "recipient", message: "required" }],
      },
      {
        type: "SET_ACTIVE_TAB",
        tab: "note",
        smsSenders: [],
      },
    );

    expect(sms.inlineError).toBeNull();
    expect(sms.fieldErrors).toEqual([]);
    expect(note.inlineError).toBeNull();
    expect(note.fieldErrors).toEqual([]);
  });
});
