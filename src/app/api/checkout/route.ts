import { cookies } from "next/headers";
import { createCheckout } from "@/lib/checkout";
import { isPlanId } from "@/lib/plans";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const plan = body?.plan;
  const key = typeof body?.idempotencyKey === "string" ? body.idempotencyKey : "";

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return Response.json({ error: "that email does not look right" }, { status: 400 });
  }
  if (!isPlanId(plan)) return Response.json({ error: "unknown plan" }, { status: 400 });
  if (!key) return Response.json({ error: "missing idempotency key" }, { status: 400 });

  const result = await createCheckout({ email, plan, idempotencyKey: key });
  if (!result.ok) return Response.json({ error: result.error }, { status: 409 });

  const jar = await cookies();
  jar.set("ledger_customer", email, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return Response.json({ url: result.url, replayed: result.replayed });
}
