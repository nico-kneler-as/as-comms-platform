interface AttachmentUpstreamConfig {
  readonly baseUrl: string;
  readonly bearerToken: string;
}

function readAttachmentUpstreamConfig(
  env: NodeJS.ProcessEnv,
): AttachmentUpstreamConfig | null {
  const baseUrl = env.GMAIL_CAPTURE_BASE_URL?.trim();
  const bearerToken = env.GMAIL_CAPTURE_TOKEN?.trim();

  if (!baseUrl || !bearerToken) {
    return null;
  }

  return {
    baseUrl,
    bearerToken,
  };
}

export async function fetchAttachmentUpstream(input: {
  readonly id: string;
  readonly signal?: AbortSignal;
  readonly fetchImplementation?: typeof fetch;
}): Promise<Response | null> {
  const config = readAttachmentUpstreamConfig(process.env);
  if (config === null) {
    return null;
  }

  const fetchImplementation = input.fetchImplementation ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") {
    throw new Error("Global fetch is unavailable.");
  }

  return fetchImplementation(
    new URL(`/internal/attachments/${encodeURIComponent(input.id)}`, config.baseUrl),
    {
      method: "GET",
      headers: {
        authorization: `Bearer ${config.bearerToken}`,
      },
      signal: input.signal ?? AbortSignal.timeout(10_000),
    },
  );
}
