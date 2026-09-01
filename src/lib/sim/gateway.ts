import { db } from "@/lib/db";
import { PLANS, isPlanId } from "@/lib/plans";
import { deliver, makeEvent, simId, invoiceObject } from "./events";

// Drives the parts of the lifecycle that Stripe's own clock would drive in
// live mode: the trial ending, a renewal landing, a card declining, and the
// dunning retries that follow. Only used when there's no secret key set.

export type Outcome = "paid" | "declined";

const MONTH = 30 * 86400_000;

async function load(id: string) {
  const sub = await db.subscription.findUnique({ where: { id }, include: { customer: true } });
  if (!sub || !isPlanId(sub.plan)) return null;
  const plan = sub.plan;
  return { ...sub, plan };
}

export async function advanceCycle(subscriptionId: string, outcome: Outcome) {
  const sub = await load(subscriptionId);
  if (!sub) return { ok: false as const, error: "subscription not found" };
  if (sub.status === "canceled") return { ok: false as const, error: "subscription is canceled" };

  const start = sub.currentPeriodEnd;
  const end = new Date(start.getTime() + MONTH);
  const amount = PLANS[sub.plan].price;

  await deliver(
    makeEvent(
      outcome === "paid" ? "invoice.payment_succeeded" : "invoice.payment_failed",
      invoiceObject({
        id: simId("in"),
        customer: sub.customer.stripeCustomerId,
        subscription: sub.stripeSubscriptionId,
        amount,
        paid: outcome === "paid" ? amount : 0,
        attempt: 1,
        periodStart: start,
        periodEnd: end,
      }),
    ),
  );

  return { ok: true as const };
}

// Stripe bumps attempt_count on the same invoice rather than issuing a new
// one, so the retry has to reuse the open invoice id or the dunning counter
// on our side drifts away from theirs.
export async function retryOpenInvoice(subscriptionId: string, outcome: Outcome) {
  const sub = await load(subscriptionId);
  if (!sub) return { ok: false as const, error: "subscription not found" };

  const open = await db.invoice.findFirst({
    where: { subscriptionId: sub.id, status: "open" },
    orderBy: { createdAt: "desc" },
  });
  if (!open) return { ok: false as const, error: "no open invoice to retry" };

  await deliver(
    makeEvent(
      outcome === "paid" ? "invoice.payment_succeeded" : "invoice.payment_failed",
      invoiceObject({
        id: open.stripeInvoiceId,
        customer: sub.customer.stripeCustomerId,
        subscription: sub.stripeSubscriptionId,
        amount: open.amountDue,
        paid: outcome === "paid" ? open.amountDue : 0,
        attempt: open.attemptCount + 1,
        periodStart: open.periodStart,
        periodEnd: open.periodEnd,
      }),
    ),
  );

  return { ok: true as const };
}

export async function endTrial(subscriptionId: string, outcome: Outcome) {
  const sub = await load(subscriptionId);
  if (!sub) return { ok: false as const, error: "subscription not found" };
  if (sub.status !== "trialing") return { ok: false as const, error: "not on trial" };

  const start = sub.trialEndsAt ?? sub.currentPeriodEnd;
  const end = new Date(start.getTime() + MONTH);
  const amount = PLANS[sub.plan].price;

  await deliver(
    makeEvent(
      outcome === "paid" ? "invoice.payment_succeeded" : "invoice.payment_failed",
      invoiceObject({
        id: simId("in"),
        customer: sub.customer.stripeCustomerId,
        subscription: sub.stripeSubscriptionId,
        amount,
        paid: outcome === "paid" ? amount : 0,
        attempt: 1,
        periodStart: start,
        periodEnd: end,
      }),
    ),
  );

  return { ok: true as const };
}
