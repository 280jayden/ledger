import { db } from "@/lib/db";
import { receive, sign } from "@/lib/webhook/receive";

// The same thing the Resend button in the Stripe dashboard does: take the
// payload we stored on first delivery and put it back through the endpoint,
// signature check and all.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const event = await db.webhookEvent.findUnique({ where: { id } });
  if (!event) return Response.json({ error: "no such event" }, { status: 404 });

  const result = await receive(event.payload, sign(event.payload));
  return Response.json(result);
}
