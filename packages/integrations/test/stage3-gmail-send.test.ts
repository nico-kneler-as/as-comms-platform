import { describe, expect, it, vi } from "vitest";

import { sendGmailMessage } from "../src/index.js";

function hasRequestUrl(input: unknown): input is { url: string } {
  return (
    typeof input === "object" &&
    input !== null &&
    "url" in input &&
    typeof input.url === "string"
  );
}

function resolveRequestUrl(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  if (hasRequestUrl(input)) {
    return input.url;
  }

  throw new Error("Expected request input to be a string, URL, or Request-like object.");
}

function parseSendRequestBody(
  call: readonly unknown[]
): Record<string, unknown> {
  const init = call[1] as RequestInit | undefined;
  const body = init?.body;

  if (typeof body !== "string") {
    throw new Error("Expected fetch body to be a JSON string.");
  }

  return JSON.parse(body) as Record<string, unknown>;
}

function getFetchCall(
  mock: ReturnType<typeof createFetchMock>,
  index: number
): readonly unknown[] {
  const call = mock.mock.calls[index];

  if (call === undefined) {
    throw new Error(`Expected fetch call at index ${String(index)}.`);
  }

  return call;
}

function decodeRawMessage(raw: string): string {
  return Buffer.from(raw, "base64url").toString("utf8");
}

function createFetchMock(input?: {
  readonly sendResponse?: Response;
  readonly tokenResponse?: Response;
}) {
  return vi.fn(
    (request: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const requestUrl = resolveRequestUrl(request);

      if (requestUrl === "https://oauth2.googleapis.com/token") {
        return Promise.resolve(
          input?.tokenResponse ??
            new Response(
              JSON.stringify({
                access_token: "gmail-access-token",
                expires_in: 3600
              }),
              {
                status: 200,
                headers: {
                  "content-type": "application/json"
                }
              }
            )
        );
      }

      if (requestUrl === "https://gmail.googleapis.com/gmail/v1/users/me/messages/send") {
        return Promise.resolve(
          input?.sendResponse ??
            new Response(
              JSON.stringify({
                id: "gmail-message-1",
                threadId: "gmail-thread-1"
              }),
              {
                status: 200,
                headers: {
                  "content-type": "application/json"
                }
              }
            )
        );
      }

      throw new Error(
        `Unexpected URL: ${requestUrl} with method ${init?.method ?? "GET"}`
      );
    }
  );
}

const baseConfig = {
  liveAccount: "volunteers@adventurescientists.org",
  oauthClient: {
    clientId: "gmail-oauth-client-id",
    clientSecret: "gmail-oauth-client-secret",
    tokenUri: "https://oauth2.googleapis.com/token"
  },
  oauthRefreshToken: "gmail-oauth-refresh-token",
  now: () => new Date("2026-04-21T12:00:00.000Z")
} as const;

describe("Stage 3 Gmail send client", () => {
  it("builds a plaintext reply with threading headers and sends the Gmail thread id", async () => {
    const fetchImplementation = createFetchMock();
    const result = await sendGmailMessage(
      {
        fromAlias: "pnwbio@adventurescientists.org",
        to: "volunteer@example.org",
        subject: "Re: Field update",
        bodyPlaintext: "Thanks for the update.\nWe are reviewing it now.",
        bodyHtml:
          "<p><strong>Thanks</strong> for the update.</p><p>We are reviewing it now.</p>",
        attachments: [],
        threadId: "gmail-thread-parent-1",
        inReplyToRfc822MessageId: "<parent-message@example.org>",
        referencesRfc822MessageIds: [
          "<grandparent-message@example.org>",
          "<parent-message@example.org>"
        ]
      },
      {
        ...baseConfig,
        fetchImplementation
      }
    );

    expect(result).toMatchObject({
      kind: "success",
      gmailMessageId: "gmail-message-1",
      gmailThreadId: "gmail-thread-1"
    });

    const sendCall = getFetchCall(fetchImplementation, 1);
    const requestBody = parseSendRequestBody(sendCall);

    expect(requestBody.threadId).toBe("gmail-thread-parent-1");

    const rawMessage = decodeRawMessage(String(requestBody.raw));

    expect(rawMessage).toContain("From: <pnwbio@adventurescientists.org>");
    expect(rawMessage).toContain("To: <volunteer@example.org>");
    expect(rawMessage).toContain("Subject: Re: Field update");
    expect(rawMessage).toContain("In-Reply-To: <parent-message@example.org>");
    expect(rawMessage).toContain(
      "References: <grandparent-message@example.org> <parent-message@example.org>"
    );
    expect(rawMessage).toContain("Content-Type: multipart/alternative; boundary=");
    expect(rawMessage).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(rawMessage).toContain("Content-Type: text/html; charset=UTF-8");
    expect(rawMessage).not.toContain("multipart/mixed");
    expect(rawMessage).toContain("Thanks for the update.\r\nWe are reviewing it now.");
    expect(rawMessage).toContain("<p><strong>Thanks</strong> for the update.</p>");
    expect(rawMessage).toMatch(/Message-ID: <[^>]+>/u);
    expect(result.kind === "success" ? result.rfc822MessageId : "").toMatch(
      /^<[^>]+>$/u
    );
  });

  it("builds a net-new plaintext message without a Gmail thread id", async () => {
    const fetchImplementation = createFetchMock();
    const result = await sendGmailMessage(
      {
        fromAlias: "pnwbio@adventurescientists.org",
        to: "new-contact@example.org",
        subject: "Proyecto Ártico",
        bodyPlaintext: "Hello from Adventure Scientists.",
        bodyHtml: "<p>Hello from Adventure Scientists.</p>",
        attachments: []
      },
      {
        ...baseConfig,
        fetchImplementation
      }
    );

    expect(result.kind).toBe("success");

    const sendCall = getFetchCall(fetchImplementation, 1);
    const requestBody = parseSendRequestBody(sendCall);

    expect("threadId" in requestBody).toBe(false);

    const rawMessage = decodeRawMessage(String(requestBody.raw));

    expect(rawMessage).toContain("To: <new-contact@example.org>");
    expect(rawMessage).toContain("Subject: =?UTF-8?B?UHJveWVjdG8gw4FydGljbw==?=");
    expect(rawMessage).not.toContain("In-Reply-To:");
    expect(rawMessage).not.toContain("References:");
    expect(rawMessage).toContain("Content-Type: multipart/alternative; boundary=");
    expect(rawMessage).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(rawMessage).toContain("Content-Type: text/html; charset=UTF-8");
  });

  it("builds a multipart message when attachments are present", async () => {
    const fetchImplementation = createFetchMock();
    const result = await sendGmailMessage(
      {
        fromAlias: "pnwbio@adventurescientists.org",
        to: "volunteer@example.org",
        subject: "Field kit files",
        bodyPlaintext: "Attached are the kit files.",
        bodyHtml: "<p>Attached are the <em>kit</em> files.</p>",
        attachments: [
          {
            filename: "briefing.txt",
            contentType: "text/plain",
            contentBase64: Buffer.from("First attachment", "utf8").toString("base64")
          },
          {
            filename: "checklist.csv",
            contentType: "text/csv",
            contentBase64: Buffer.from("a,b,c\n1,2,3\n", "utf8").toString("base64")
          }
        ]
      },
      {
        ...baseConfig,
        fetchImplementation
      }
    );

    expect(result.kind).toBe("success");

    const sendCall = getFetchCall(fetchImplementation, 1);
    const rawMessage = decodeRawMessage(
      String(parseSendRequestBody(sendCall).raw)
    );

    expect(rawMessage).toContain("Content-Type: multipart/mixed; boundary=");
    expect(rawMessage).toContain("Content-Type: multipart/alternative; boundary=");
    expect(rawMessage).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(rawMessage).toContain("Content-Type: text/html; charset=UTF-8");
    expect(rawMessage).toContain('Content-Disposition: attachment; filename="briefing.txt"');
    expect(rawMessage).toContain('Content-Disposition: attachment; filename="checklist.csv"');
    expect(rawMessage).toContain(
      Buffer.from("First attachment", "utf8").toString("base64")
    );
    expect(rawMessage).toContain(
      Buffer.from("a,b,c\n1,2,3\n", "utf8").toString("base64")
    );
  });

  it("maps Gmail and OAuth failures into the typed error variants", async () => {
    const cases = [
      {
        name: "auth_error",
        fetchImplementation: createFetchMock({
          tokenResponse: new Response(
            JSON.stringify({
              error: "invalid_grant"
            }),
            {
              status: 401,
              headers: {
                "content-type": "application/json"
              }
            }
          )
        }),
        expected: {
          kind: "auth_error",
          detail:
            "OAuth refresh token expired, was revoked, or lost required permissions."
        }
      },
      {
        name: "scope_error",
        fetchImplementation: createFetchMock({
          sendResponse: new Response(
            JSON.stringify({
              error: {
                code: 403,
                message: "Request had insufficient authentication scopes.",
                status: "PERMISSION_DENIED",
                errors: [
                  {
                    message: "Insufficient Permission",
                    reason: "insufficientPermissions"
                  }
                ]
              }
            }),
            {
              status: 403,
              headers: {
                "content-type": "application/json"
              }
            }
          )
        }),
        expected: {
          kind: "scope_error",
          detail: "Request had insufficient authentication scopes."
        }
      },
      {
        name: "send_as_not_authorized",
        fetchImplementation: createFetchMock({
          sendResponse: new Response(
            JSON.stringify({
              error: {
                code: 403,
                message: "Delegation denied for pnwbio@adventurescientists.org",
                status: "PERMISSION_DENIED"
              }
            }),
            {
              status: 403,
              headers: {
                "content-type": "application/json"
              }
            }
          )
        }),
        expected: {
          kind: "send_as_not_authorized",
          alias: "pnwbio@adventurescientists.org"
        }
      },
      {
        name: "invalid_recipient",
        fetchImplementation: createFetchMock({
          sendResponse: new Response(
            JSON.stringify({
              error: {
                code: 400,
                message: "Invalid To header",
                status: "INVALID_ARGUMENT"
              }
            }),
            {
              status: 400,
              headers: {
                "content-type": "application/json"
              }
            }
          )
        }),
        expected: {
          kind: "invalid_recipient",
          detail: "Invalid To header"
        }
      },
      {
        name: "rate_limited",
        fetchImplementation: createFetchMock({
          sendResponse: new Response(
            JSON.stringify({
              error: {
                code: 429,
                message: "Rate limit exceeded",
                status: "RESOURCE_EXHAUSTED"
              }
            }),
            {
              status: 429,
              headers: {
                "content-type": "application/json",
                "retry-after": "120"
              }
            }
          )
        }),
        expected: {
          kind: "rate_limited",
          retryAfterSeconds: 120
        }
      },
      {
        name: "transient",
        fetchImplementation: createFetchMock({
          sendResponse: new Response(
            JSON.stringify({
              error: {
                code: 503,
                message: "Backend error",
                status: "UNAVAILABLE"
              }
            }),
            {
              status: 503,
              headers: {
                "content-type": "application/json"
              }
            }
          )
        }),
        expected: {
          kind: "transient",
          detail: "Backend error"
        }
      },
      {
        name: "permanent",
        fetchImplementation: createFetchMock({
          sendResponse: new Response(
            JSON.stringify({
              error: {
                code: 400,
                message: "Precondition check failed.",
                status: "FAILED_PRECONDITION"
              }
            }),
            {
              status: 400,
              headers: {
                "content-type": "application/json"
              }
            }
          )
        }),
        expected: {
          kind: "permanent",
          detail: "Precondition check failed."
        }
      }
    ] as const;

    for (const testCase of cases) {
      const result = await sendGmailMessage(
        {
          fromAlias: "pnwbio@adventurescientists.org",
          to: "volunteer@example.org",
          subject: `Case ${testCase.name}`,
          bodyPlaintext: "Test body",
          bodyHtml: "<p>Test body</p>",
          attachments: []
        },
        {
          ...baseConfig,
          fetchImplementation: testCase.fetchImplementation
        }
      );

      expect(result).toEqual(testCase.expected);
    }
  });

  it("fails locally when attachments exceed the 20 MB cap without calling Gmail", async () => {
    const fetchImplementation = createFetchMock();
    const oversizedAttachment = Buffer.alloc(21 * 1024 * 1024, 1).toString("base64");

    const result = await sendGmailMessage(
      {
        fromAlias: "pnwbio@adventurescientists.org",
        to: "volunteer@example.org",
        subject: "Too large",
        bodyPlaintext: "See attachment.",
        bodyHtml: "<p>See attachment.</p>",
        attachments: [
          {
            filename: "oversized.bin",
            contentType: "application/octet-stream",
            contentBase64: oversizedAttachment
          }
        ]
      },
      {
        ...baseConfig,
        fetchImplementation
      }
    );

    expect(result).toEqual({
      kind: "attachment_too_large",
      totalBytes: 21 * 1024 * 1024
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
