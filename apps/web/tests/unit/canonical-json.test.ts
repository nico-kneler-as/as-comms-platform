import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  sameCanonicalJson,
} from "../../src/lib/canonical-json";

describe("canonical JSON comparison", () => {
  it("treats documents that differ only in key order as equal", () => {
    // Postgres jsonb returns {"text":…,"type":…} for a node Tiptap emitted as
    // {"type":…,"text":…}; a plain JSON.stringify comparison called every
    // saved draft dirty forever.
    const fromEditor = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hi", marks: [{ type: "bold" }] }],
        },
      ],
    };
    const fromDatabase = {
      content: [
        {
          content: [{ marks: [{ type: "bold" }], text: "Hi", type: "text" }],
          type: "paragraph",
        },
      ],
      type: "doc",
    };

    expect(sameCanonicalJson(fromEditor, fromDatabase)).toBe(true);
  });

  it("still detects a real content change", () => {
    expect(
      sameCanonicalJson(
        { type: "doc", content: [{ type: "text", text: "a" }] },
        { type: "doc", content: [{ type: "text", text: "b" }] },
      ),
    ).toBe(false);
  });

  it("keeps array order significant", () => {
    expect(sameCanonicalJson([1, 2], [2, 1])).toBe(false);
  });

  it("handles null and primitives", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(sameCanonicalJson(null, null)).toBe(true);
    expect(sameCanonicalJson({ a: null }, { a: null })).toBe(true);
  });
});
