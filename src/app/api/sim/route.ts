import { usingStripe } from "@/lib/stripe";
import { advanceCycle, endTrial, retryOpenInvoice } from "@/lib/sim/gateway";

const ACTIONS = {
  trial_paid: (id: string) => endTrial(id, "paid"),
  trial_declined: (id: string) => endTrial(id, "declined"),
  renew_paid: (id: string) => advanceCycle(id, "paid"),
  renew_declined: (id: string) => advanceCycle(id, "declined"),
  retry_paid: (id: string) => retryOpenInvoice(id, "paid"),
  retry_declined: (id: string) => retryOpenInvoice(id, "declined"),
};

export async function POST(req: Request) {
  // With real keys the clock belongs to Stripe, so these would only ever be
  // driven from the CLI (`stripe trigger`), not from our own endpoint.
  if (usingStripe) {
    return Response.json({ error: "not available in live mode" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const action = body?.action as keyof typeof ACTIONS;
  const id = typeof body?.subscriptionId === "string" ? body.subscriptionId : "";

  if (!(action in ACTIONS)) return Response.json({ error: "unknown action" }, { status: 400 });
  if (!id) return Response.json({ error: "missing subscriptionId" }, { status: 400 });

  const result = await ACTIONS[action](id);
  if (!result.ok) return Response.json({ error: result.error }, { status: 409 });
  return Response.json({ ok: true });
}
