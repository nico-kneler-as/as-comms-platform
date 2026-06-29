import { requireApiSession } from "@/src/server/auth/api";
import { softDeleteBroadcastMediaAsset } from "@/src/server/stage1-runtime";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  context: {
    readonly params: Promise<{
      readonly id: string;
    }>;
  },
) {
  const session = await requireApiSession();
  if (!session.ok) {
    return session.response;
  }

  const { id } = await context.params;
  await softDeleteBroadcastMediaAsset(id);

  return Response.json({ ok: true });
}
