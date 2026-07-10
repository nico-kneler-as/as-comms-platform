import { describe, expect, it } from "vitest";

import {
  firstNameFromName,
  renderSignatureTemplate,
} from "../src/signature-template.js";

describe("renderSignatureTemplate", () => {
  it("resolves the operator token with the first name", () => {
    expect(
      renderSignatureTemplate("Best,\n{{operatorFirstName}}", {
        operatorFirstName: firstNameFromName("Nico Kneler"),
      }),
    ).toBe("Best,\nNico");
  });

  it("resolves multiple operator tokens", () => {
    expect(
      renderSignatureTemplate(
        "{{operatorFirstName}}\nAdventure Scientists\n{{operatorFirstName}}",
        {
          operatorFirstName: "Hailey",
        },
      ),
    ).toBe("Hailey\nAdventure Scientists\nHailey");
  });

  it("supports operator tokens with inner whitespace", () => {
    expect(
      renderSignatureTemplate("Warmly,\n{{ operatorFirstName }}", {
        operatorFirstName: "Nico",
      }),
    ).toBe("Warmly,\nNico");
  });

  it("leaves signatures without the operator token unchanged", () => {
    expect(
      renderSignatureTemplate("Warmly,\nAdventure Scientists", {
        operatorFirstName: "Nico",
      }),
    ).toBe("Warmly,\nAdventure Scientists");
  });

  it("drops empty operator lines when the operator first name is missing", () => {
    expect(
      renderSignatureTemplate(
        "Best,\n{{operatorFirstName}}\nAdventure Scientists",
        {
          operatorFirstName: null,
        },
      ),
    ).toBe("Best,\nAdventure Scientists");

    expect(
      renderSignatureTemplate(
        "Best,\n{{operatorFirstName}}\nAdventure Scientists",
        {
          operatorFirstName: "",
        },
      ),
    ).toBe("Best,\nAdventure Scientists");
  });

  it("preserves blank lines that already existed in the template", () => {
    expect(
      renderSignatureTemplate(
        "Best,\n\n{{operatorFirstName}}\nAdventure Scientists",
        {
          operatorFirstName: null,
        },
      ),
    ).toBe("Best,\n\nAdventure Scientists");
  });

  it("leaves broadcast merge tokens untouched", () => {
    expect(
      renderSignatureTemplate("{{firstName}}\n{{operatorFirstName}}", {
        operatorFirstName: "Nico",
      }),
    ).toBe("{{firstName}}\nNico");
  });
});

describe("firstNameFromName", () => {
  it("returns the first word from a multi-word name", () => {
    expect(firstNameFromName("Hailey Smith")).toBe("Hailey");
  });

  it("returns a single-word name as-is", () => {
    expect(firstNameFromName("Nico")).toBe("Nico");
  });

  it("returns null for null input", () => {
    expect(firstNameFromName(null)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(firstNameFromName("")).toBeNull();
  });

  it("trims leading and trailing whitespace before reading the first name", () => {
    expect(firstNameFromName("  Hailey Smith  ")).toBe("Hailey");
  });
});
