import { describe, expect, it } from "vitest";

import {
  DEFAULT_SMS_OPT_OUT_FOOTER,
  findMissingSmsMergeTokens,
  renderSmsBroadcast,
  smsMetrics,
} from "../src/index.js";

describe("renderSmsBroadcast", () => {
  it.each([
    [
      "substitutes supported tokens, appends the default footer, and reports metrics for the full body",
      {
        template: "Hi {{firstName}}, reply to {{email}}",
        context: {
          firstName: "Ada",
          email: "ada@example.com",
        },
      },
      `Hi Ada, reply to ada@example.com\n\n${DEFAULT_SMS_OPT_OUT_FOOTER}`,
    ],
    [
      "substitutes tokens with surrounding whitespace inside the braces",
      {
        template: "Hi {{ firstName }}",
        context: {
          firstName: "Ada",
          email: "ada@example.com",
        },
        optOutFooter: "Text STOP",
      },
      "Hi Ada\n\nText STOP",
    ],
    [
      "renders null supported token values as empty strings",
      {
        template: "Hi {{firstName}} at {{email}}",
        context: {
          firstName: null,
          email: null,
        },
        optOutFooter: "STOP",
      },
      "Hi  at \n\nSTOP",
    ],
    [
      "renders unsupported well-formed tokens as empty strings",
      {
        template: "Hi {{lastName}}",
        context: {
          firstName: "Ada",
          email: "ada@example.com",
        },
        optOutFooter: "STOP",
      },
      "Hi \n\nSTOP",
    ],
    [
      "uses a custom footer when one is provided",
      {
        template: "Hello",
        context: {
          firstName: "Ada",
          email: "ada@example.com",
        },
        optOutFooter: "Txt STOP",
      },
      "Hello\n\nTxt STOP",
    ],
    [
      "omits the footer and trailing separator when optOutFooter is empty",
      {
        template: "Hello",
        context: {
          firstName: "Ada",
          email: "ada@example.com",
        },
        optOutFooter: "",
      },
      "Hello",
    ],
  ])("%s", (_label, input, expectedBody) => {
    const rendered = renderSmsBroadcast(input);

    expect(rendered.body).toBe(expectedBody);
    expect(rendered.metrics).toEqual(smsMetrics(expectedBody));
  });

  it("counts the footer in SMS segment metrics", () => {
    const rendered = renderSmsBroadcast({
      template: "a".repeat(140),
      context: {
        firstName: "Ada",
        email: "ada@example.com",
      },
    });

    expect(smsMetrics("a".repeat(140)).segments).toBe(1);
    expect(rendered.body).toBe(
      `${"a".repeat(140)}\n\n${DEFAULT_SMS_OPT_OUT_FOOTER}`,
    );
    expect(rendered.metrics).toEqual(smsMetrics(rendered.body));
    expect(rendered.metrics.segments).toBe(2);
  });

  it("switches metrics to Unicode when the rendered body contains emoji", () => {
    const rendered = renderSmsBroadcast({
      template: "Hi {{firstName}} 😀",
      context: {
        firstName: "Ada",
        email: "ada@example.com",
      },
      optOutFooter: "",
    });

    expect(rendered.body).toBe("Hi Ada 😀");
    expect(rendered.metrics.encoding).toBe("Unicode");
    expect(rendered.metrics).toEqual(smsMetrics(rendered.body));
  });
});

describe("findMissingSmsMergeTokens", () => {
  it.each([
    [
      "reports a referenced supported token whose value is null",
      "Hi {{firstName}}",
      {
        firstName: null,
        email: "ada@example.com",
      },
      ["firstName"],
    ],
    [
      "does not report supported tokens that the template does not reference",
      "Hi there",
      {
        firstName: null,
        email: null,
      },
      [],
    ],
    [
      "does not report supported tokens whose values are present",
      "Hi {{firstName}}",
      {
        firstName: "Ada",
        email: null,
      },
      [],
    ],
    [
      "ignores unsupported tokens",
      "Hi {{lastName}}",
      {
        firstName: null,
        email: null,
      },
      [],
    ],
    [
      "returns distinct supported tokens in first-appearance order",
      "{{email}} {{firstName}} {{email}} {{firstName}}",
      {
        firstName: null,
        email: null,
      },
      ["email", "firstName"],
    ],
  ])("%s", (_label, template, context, expected) => {
    expect(findMissingSmsMergeTokens(template, context)).toEqual(expected);
  });
});
