import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearDraft,
  loadDraft,
  saveDraft,
} from "../../app/inbox/_lib/composer-draft-storage";

class MockStorage implements Storage {
  private readonly store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

describe("composer draft storage", () => {
  let storage: MockStorage;

  beforeEach(() => {
    storage = new MockStorage();
    vi.stubGlobal("window", {
      localStorage: storage,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("saves and loads a draft payload", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    saveDraft("composer-draft:v1:actor-1:contact-1:contact", {
      subject: "Re: Expedition dates",
      bodyPlaintext: "Hello there",
      bodyHtml: "<p>Hello there</p>",
      selectedAlias: "field@adventuresci.org",
      cc: ["partner@example.org"],
      bcc: [],
      attachments: [
        {
          filename: "itinerary.pdf",
          size: 1024,
          contentType: "application/pdf",
        },
      ],
    });

    expect(
      loadDraft("composer-draft:v1:actor-1:contact-1:contact"),
    ).toMatchObject({
      subject: "Re: Expedition dates",
      bodyPlaintext: "Hello there",
      bodyHtml: "<p>Hello there</p>",
      selectedAlias: "field@adventuresci.org",
      cc: ["partner@example.org"],
      bcc: [],
      attachments: [
        {
          filename: "itinerary.pdf",
          size: 1024,
          contentType: "application/pdf",
        },
      ],
      updatedAt: 1_700_000_000_000,
    });
  });

  it("clears a saved draft", () => {
    saveDraft("composer-draft:v1:actor-1:contact-1:contact", {
      subject: "Hello",
      bodyPlaintext: "Body",
      bodyHtml: "<p>Body</p>",
      selectedAlias: null,
      cc: [],
      bcc: [],
      attachments: [],
    });

    clearDraft("composer-draft:v1:actor-1:contact-1:contact");

    expect(loadDraft("composer-draft:v1:actor-1:contact-1:contact")).toBeNull();
  });

  it("drops the oldest draft when total localStorage usage exceeds 4 MB", () => {
    storage.setItem("non-draft", "x".repeat(2_085_000));
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(200);

    saveDraft("composer-draft:v1:actor-1:contact-1:contact", {
      subject: "Old draft",
      bodyPlaintext: "a".repeat(5_000),
      bodyHtml: `<p>${"a".repeat(5_000)}</p>`,
      selectedAlias: null,
      cc: [],
      bcc: [],
      attachments: [],
    });
    saveDraft("composer-draft:v1:actor-1:contact-2:contact", {
      subject: "New draft",
      bodyPlaintext: "b".repeat(5_000),
      bodyHtml: `<p>${"b".repeat(5_000)}</p>`,
      selectedAlias: null,
      cc: [],
      bcc: [],
      attachments: [],
    });

    expect(loadDraft("composer-draft:v1:actor-1:contact-1:contact")).toBeNull();
    expect(
      loadDraft("composer-draft:v1:actor-1:contact-2:contact"),
    ).not.toBeNull();
    expect(storage.getItem("non-draft")).not.toBeNull();
  });
});
