import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:http";

import { describe, expect, it } from "vitest";

import { exitCleanlyOnShutdown } from "../src/index.js";

function fakeProcess() {
  const events = new EventEmitter();
  const exits: number[] = [];
  return {
    events,
    exits,
    processLike: {
      once: (event: NodeJS.Signals, listener: () => void) =>
        events.once(event, listener),
      exit: (code: number) => {
        exits.push(code);
      },
    },
  };
}

async function listening(): Promise<Server> {
  const server = createServer((_request, response) => {
    response.end("ok");
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  return server;
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50 && !check(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("Gmail capture shutdown", () => {
  it("closes the server and exits 0 on SIGTERM", async () => {
    const server = await listening();
    const fake = fakeProcess();
    exitCleanlyOnShutdown(server, { processLike: fake.processLike });

    fake.events.emit("SIGTERM");
    await waitFor(() => fake.exits.length > 0);

    expect(fake.exits).toEqual([0]);
    expect(server.listening).toBe(false);
  });

  it("shuts down once when both SIGTERM and SIGINT arrive", async () => {
    const server = await listening();
    const fake = fakeProcess();
    exitCleanlyOnShutdown(server, { processLike: fake.processLike });

    fake.events.emit("SIGTERM");
    fake.events.emit("SIGINT");
    await waitFor(() => fake.exits.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(fake.exits).toEqual([0]);
  });

  it("still exits 0 when a request holds the server open", async () => {
    const server = createServer(() => {
      // Never answers: keeps its connection busy.
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected a TCP address");
    }
    const pending = fetch(`http://127.0.0.1:${String(address.port)}/`).catch(
      () => null,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    const fake = fakeProcess();
    exitCleanlyOnShutdown(server, {
      graceMs: 50,
      processLike: fake.processLike,
    });
    fake.events.emit("SIGTERM");
    await waitFor(() => fake.exits.length > 0);

    expect(fake.exits).toEqual([0]);
    server.closeAllConnections();
    await pending;
  });
});
