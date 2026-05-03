import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";

import {
  createSmsCaptureServer,
  readSmsCaptureRuntimeConfig,
} from "../src/server.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error === undefined) {
              resolve();
              return;
            }

            reject(error);
          });
        }),
    ),
  );
});

function listen(server: Server): Promise<string> {
  servers.push(server);

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        resolve(`http://127.0.0.1:${address.port.toString()}`);
        return;
      }

      reject(new Error("Expected TCP server address."));
    });
  });
}

describe("SMS capture server", () => {
  it("rejects unsigned inbound webhook requests", async () => {
    const config = readSmsCaptureRuntimeConfig({
      TWILIO_ACCOUNT_SID: "AC00000000000000000000000000000000",
      TWILIO_AUTH_TOKEN: "twilio-token",
      TWILIO_MESSAGING_SERVICE_SID_OR_FROM_NUMBER: "+14065550142",
    });
    const baseUrl = await listen(createSmsCaptureServer({ config }));

    const response = await fetch(`${baseUrl}/webhooks/inbound`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        MessageSid: "SM00000000000000000000000000000000",
        From: "+14065550142",
        To: "+14065550143",
        Body: "hello",
        NumMedia: "0",
      }),
    });

    expect(response.status).toBe(401);
  });
});
