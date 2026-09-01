import { cancel } from "@/lib/subscription/actions";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const atPeriodEnd = body?.atPeriodEnd !== false;

  const result = await cancel(id, atPeriodEnd);
  if (!result.ok) return Response.json({ error: result.error }, { status: 409 });
  return Response.json({ ok: true });
}
