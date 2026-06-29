import { describe, expect, it } from "vitest";

import { prepareUploadedHtml } from "../src/html-import.js";

describe("prepareUploadedHtml", () => {
  it.each([
    ["plain tag", "Hey *|FNAME|*,", "Hey {{firstName}},"],
    ["spaced tag", "Hey *| FNAME |*,", "Hey {{firstName}},"],
  ])("converts the supported first-name merge tag for %s", (_label, input, expected) => {
    expect(prepareUploadedHtml(input)).toEqual({
      html: expected,
      warnings: [],
    });
  });

  it("warns about distinct leftover Mailchimp tags and excludes converted FNAME", () => {
    const result = prepareUploadedHtml(
      "<p>*|FNAME|*</p><p>*|CURRENT_YEAR|*</p><p>*| LIST:COMPANY |*</p><p>*|CURRENT_YEAR|*</p>",
    );

    expect(result.html).toBe(
      "<p>{{firstName}}</p><p>*|CURRENT_YEAR|*</p><p>*| LIST:COMPANY |*</p><p>*|CURRENT_YEAR|*</p>",
    );
    expect(result.warnings).toContain(
      "Unsupported Mailchimp tags left as-is and will not render: *|CURRENT_YEAR|*, *|LIST:COMPANY|*",
    );
  });

  it("warns when an unsubscribe/footer block is present", () => {
    const fromText = prepareUploadedHtml("<p><a href=\"#\">unsubscribe</a></p>");
    const fromTag = prepareUploadedHtml("<p>*| UPDATE_PROFILE |*</p>");

    expect(fromText.warnings).toContain(
      "An unsubscribe/footer block was detected — remove it; the platform appends its own unsubscribe footer.",
    );
    expect(fromTag.warnings).toContain(
      "An unsubscribe/footer block was detected — remove it; the platform appends its own unsubscribe footer.",
    );
  });

  it("does not warn about unsubscribe/footer content when absent", () => {
    const result = prepareUploadedHtml("<p>Hello {{firstName}}</p>");

    expect(result.warnings).not.toContain(
      "An unsubscribe/footer block was detected — remove it; the platform appends its own unsubscribe footer.",
    );
  });

  it("returns clean html unchanged when no Mailchimp artifacts are present", () => {
    const input = "<!doctype html><html><body><p>Hello there.</p></body></html>";

    expect(prepareUploadedHtml(input)).toEqual({
      html: input,
      warnings: [],
    });
  });

  it("converts FNAME, preserves the footer, and emits both warnings for a realistic document", () => {
    const input = `<!doctype html>
<html>
  <body>
    <table role="presentation">
      <tr>
        <td>
          <p>Hey *|FNAME|*,</p>
          <p>News from the field.</p>
          <p><a href="*|UNSUB|*">Unsubscribe</a></p>
          <p>&copy; *|CURRENT_YEAR|* Adventure Scientists</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    const result = prepareUploadedHtml(input);

    expect(result.html).toContain("Hey {{firstName}},");
    expect(result.html).toContain('<a href="*|UNSUB|*">Unsubscribe</a>');
    expect(result.html).toContain("&copy; *|CURRENT_YEAR|* Adventure Scientists");
    expect(result.warnings).toContain(
      "Unsupported Mailchimp tags left as-is and will not render: *|UNSUB|*, *|CURRENT_YEAR|*",
    );
    expect(result.warnings).toContain(
      "An unsubscribe/footer block was detected — remove it; the platform appends its own unsubscribe footer.",
    );
  });
});
