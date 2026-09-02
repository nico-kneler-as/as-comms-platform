import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

export const dynamic = "force-dynamic";

const unavailableHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>This email isn't available</title></head><body><main><h1>This email isn't available</h1><p>The email you're looking for isn't available. It may not have been sent yet, or it was taken down.</p><p><a href="https://www.adventurescientists.org">Adventure Scientists</a></p></main></body></html>`;

function unavailableResponse(): Response {
  return new Response(unavailableHtml, {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly token: string }> },
): Promise<Response> {
  const { token } = await context.params;
  let decodedToken: string;
  try {
    decodedToken = decodeURIComponent(token);
  } catch {
    return unavailableResponse();
  }

  const runtime = await getStage1WebRuntime();
  const version =
    await runtime.campaigns.broadcastWebVersions.findPublishedByToken(
      decodedToken,
    );
  // findPublishedByToken already requires rendered HTML, but keep the
  // guard: an unknown token (null row) and an unrendered row both map to
  // the same neutral page.
  const renderedHtml = version?.renderedHtml ?? null;
  if (renderedHtml === null) {
    return unavailableResponse();
  }

  return new Response(renderedHtml, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}
