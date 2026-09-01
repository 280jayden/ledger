import { previewChange } from "@/lib/subscription/actions";
import { isPlanId } from "@/lib/plans";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const to = new URL(req.url).searchParams.get("to");

  if (!isPlanId(to)) return Response.json({ error: "unknown plan" }, { status: 400 });

  const result = await previewChange(id, to);
  if (!result.ok) return Response.json({ error: result.error }, { status: 404 });
  return Response.json(result);
}
