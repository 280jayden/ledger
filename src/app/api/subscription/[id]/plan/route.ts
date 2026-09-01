import { changePlan } from "@/lib/subscription/actions";
import { isPlanId } from "@/lib/plans";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);

  if (!isPlanId(body?.plan)) return Response.json({ error: "unknown plan" }, { status: 400 });
  const key = typeof body?.idempotencyKey === "string" ? body.idempotencyKey : "";
  if (!key) return Response.json({ error: "missing idempotency key" }, { status: 400 });

  const result = await changePlan(id, body.plan, key);
  if (!result.ok) return Response.json({ error: result.error }, { status: 409 });
  return Response.json({ proration: result.proration });
}
