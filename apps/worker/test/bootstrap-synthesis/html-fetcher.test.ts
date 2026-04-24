import { describe, expect, it } from "vitest";

import { fetchAndExtract } from "../../src/jobs/bootstrap-project-knowledge/fetchers/html-fetcher.js";

function mockFetch(html: string, status = 200): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(html, {
        status,
        headers: {
          "content-type": "text/html",
        },
      }),
    );
}

describe("bootstrap HTML fetcher", () => {
  it("extracts title and readable body text from a typical page", async () => {
    const result = await fetchAndExtract("https://example.org/project", {
      fetchImplementation: mockFetch(`
        <!doctype html>
        <html>
          <head><title>Trail Survey</title></head>
          <body>
            <nav>Navigation that should not dominate.</nav>
            <main>
              <article>
                <h1>Trail Survey Volunteer Guide</h1>
                <p>Volunteers should review the field kit before departure.</p>
                <p>Training is required before submitting observations.</p>
              </article>
            </main>
          </body>
        </html>
      `),
    });

    expect(result.title).toBe("Trail Survey");
    expect(result.markdown).toContain("Volunteers should review the field kit");
    expect(result.wordCount).toBeGreaterThan(8);
  });

  it("falls back to body text for malformed HTML", async () => {
    const result = await fetchAndExtract("https://example.org/garbage", {
      fetchImplementation: mockFetch(
        "<html><body><p>Garbage page still has useful training notes",
      ),
    });

    expect(result.markdown).toContain("Garbage page still has useful training notes");
    expect(result.wordCount).toBeGreaterThan(0);
  });

  it("returns an empty extraction for an empty body", async () => {
    const result = await fetchAndExtract("https://example.org/empty", {
      fetchImplementation: mockFetch(""),
    });

    expect(result).toEqual({
      title: null,
      markdown: "",
      wordCount: 0,
    });
  });
});
