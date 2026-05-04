import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { Sparkline7 } from "../../app/inbox/_components/sparkline-7";

Object.assign(globalThis, { React });

describe("Sparkline7", () => {
  it("renders an svg with 7 bars", () => {
    const html = renderToStaticMarkup(
      <Sparkline7
        values={[1, 3, 2, 4, 3, 5, 6]}
        tone="sky"
        metricKey="signups"
      />,
    );

    expect(html).toContain("<svg");
    expect((html.match(/<rect/g) ?? []).length).toBe(7);
  });

  it("renders 7 baseline bars for an all-zero sparkline", () => {
    const html = renderToStaticMarkup(
      <Sparkline7
        values={[0, 0, 0, 0, 0, 0, 0]}
        tone="emerald"
        metricKey="trainingCompletions"
      />,
    );

    expect((html.match(/<rect/g) ?? []).length).toBe(7);
  });
});
