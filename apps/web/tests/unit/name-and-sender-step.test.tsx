import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

Object.assign(globalThis, { React });

vi.mock("lucide-react", () => ({
  ArrowLeft: () => null,
  ArrowRight: () => null,
  Check: () => null,
  Info: () => null,
}));

import { NameAndSenderStep } from "../../app/broadcasts/new/_components/name-and-sender-step";

const orgSender = {
  projectId: null,
  projectName: "Adventure Scientists",
  projectAliasLabel: "Adventure Scientists",
  email: "info@adventurescientists.org",
  connectedToProjectId: null,
  status: "verified" as const,
  senderType: "org" as const,
};

const projectSender = {
  ...orgSender,
  projectId: "project-1",
  email: "forests@adventurescientists.org",
  senderType: "project" as const,
};

describe("NameAndSenderStep reply-to", () => {
  it("shows an org email reply-to, defaults it from state, and blocks an invalid address", () => {
    const markup = renderToStaticMarkup(
      <NameAndSenderStep
        launchType="normal_email"
        name="Insiders update"
        fromEmail={orgSender.email}
        replyToEmail="not-an-email"
        senderOptions={[orgSender]}
        activeSmsSender={null}
        frozen={false}
        onNameChange={() => undefined}
        onFromEmailChange={() => undefined}
        onReplyToEmailChange={() => undefined}
        onBack={() => undefined}
        onContinue={() => undefined}
      />,
    );

    expect(markup).toContain("Reply-to");
    expect(markup).toContain('value="not-an-email"');
    expect(markup).toContain("Enter a valid reply-to email address.");
    expect(markup).toContain("disabled=\"\"");
  });

  it("does not show reply-to for project senders or SMS", () => {
    const projectMarkup = renderToStaticMarkup(
      <NameAndSenderStep
        launchType="normal_email"
        name="Project update"
        fromEmail={projectSender.email}
        replyToEmail={projectSender.email}
        senderOptions={[projectSender]}
        activeSmsSender={null}
        frozen={false}
        onNameChange={() => undefined}
        onFromEmailChange={() => undefined}
        onReplyToEmailChange={() => undefined}
        onBack={() => undefined}
        onContinue={() => undefined}
      />,
    );
    const smsMarkup = renderToStaticMarkup(
      <NameAndSenderStep
        launchType="sms"
        name="SMS update"
        fromEmail={null}
        replyToEmail={null}
        senderOptions={[orgSender]}
        activeSmsSender={{
          id: "sms-sender",
          displayName: "Adventure Scientists",
          phoneE164: "+14065550123",
        }}
        frozen={false}
        onNameChange={() => undefined}
        onFromEmailChange={() => undefined}
        onReplyToEmailChange={() => undefined}
        onBack={() => undefined}
        onContinue={() => undefined}
      />,
    );

    expect(projectMarkup).not.toContain("Reply-to");
    expect(smsMarkup).not.toContain("Reply-to");
  });
});
