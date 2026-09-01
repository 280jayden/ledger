import { db } from "@/lib/db";
import { isPlanId, type PlanId } from "@/lib/plans";
import { prorate, type Proration } from "@/lib/billing/proration";
import { stripe, usingStripe } from "@/lib/stripe";
import { deliver, makeEvent, simId, subObject, invoiceObject } from "@/lib/sim/events";

type Fail = { ok: false; error: string };

async function load(id: string) {
  const sub = await db.subscription.findUnique({ where: { id }, include: { customer: true } });
  if (!sub || !isPlanId(sub.plan)) return null;
  const plan = sub.plan;
  return { ...sub, plan };
}

export async function previewChange(
  subscriptionId: string,
  to: PlanId,
): Promise<({ ok: true } & Proration) | Fail> {
  const sub = await load(subscriptionId);
  if (!sub) return { ok: false, error: "subscription not found" };
  const p = prorate(sub.plan, to, sub.currentPeriodStart, sub.currentPeriodEnd);
  return { ok: true, ...p };
}

export async function changePlan(
  subscriptionId: string,
  to: PlanId,
  idempotencyKey: string,
): Promise<{ ok: true; proration: Proration } | Fail> {
  const sub = await load(subscriptionId);
  if (!sub) return { ok: false, error: "subscription not found" };
  if (sub.plan === to) return { ok: false, error: "already on that plan" };
  if (sub.status === "canceled") return { ok: false, error: "subscription is canceled" };
  // Letting someone switch plans while an invoice is still in dunning would
  // credit them for a period they never paid for.
  if (sub.status === "past_due") {
    return { ok: false, error: "settle the open invoice before changing plans" };
  }

  const p = prorate(sub.plan, to, sub.currentPeriodStart, sub.currentPeriodEnd);

  if (usingStripe) {
    const live = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
    const price = process.env[`STRIPE_PRICE_${to.toUpperCase()}`];
    if (!price) return { ok: false, error: `set STRIPE_PRICE_${to.toUpperCase()}` };
    await stripe.subscriptions.update(
      sub.stripeSubscriptionId,
      {
        items: [{ id: live.items.data[0].id, price }],
        proration_behavior: "create_prorations",
        metadata: { plan: to },
      },
      { idempotencyKey },
    );
    return { ok: true, proration: p };
  }

  await deliver(
    makeEvent(
      "customer.subscription.updated",
      subObject({
        id: sub.stripeSubscriptionId,
        customer: sub.customer.stripeCustomerId,
        plan: to,
        status: sub.status,
        trialEnd: sub.trialEndsAt,
        periodStart: sub.currentPeriodStart,
        periodEnd: sub.currentPeriodEnd,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      }),
    ),
  );

  // Trials owe nothing yet, so an upgrade mid-trial just swaps the plan.
  if (sub.status === "active" && p.dueNow > 0) {
    await deliver(
      makeEvent(
        "invoice.payment_succeeded",
        invoiceObject({
          id: simId("in"),
          customer: sub.customer.stripeCustomerId,
          subscription: sub.stripeSubscriptionId,
          amount: p.dueNow,
          paid: p.dueNow,
          attempt: 1,
          periodStart: sub.currentPeriodStart,
          periodEnd: sub.currentPeriodEnd,
        }),
      ),
    );
  }

  return { ok: true, proration: p };
}

export async function cancel(
  subscriptionId: string,
  atPeriodEnd: boolean,
): Promise<{ ok: true } | Fail> {
  const sub = await load(subscriptionId);
  if (!sub) return { ok: false, error: "subscription not found" };
  if (sub.status === "canceled") return { ok: false, error: "already canceled" };

  if (usingStripe) {
    if (atPeriodEnd) {
      await stripe.subscriptions.update(sub.stripeSubscriptionId, { cancel_at_period_end: true });
    } else {
      await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
    }
    return { ok: true };
  }

  const base = {
    id: sub.stripeSubscriptionId,
    customer: sub.customer.stripeCustomerId,
    plan: sub.plan,
    trialEnd: sub.trialEndsAt,
    periodStart: sub.currentPeriodStart,
    periodEnd: sub.currentPeriodEnd,
  };

  if (atPeriodEnd) {
    await deliver(
      makeEvent(
        "customer.subscription.updated",
        subObject({ ...base, status: sub.status, cancelAtPeriodEnd: true }),
      ),
    );
    return { ok: true };
  }

  await deliver(
    makeEvent(
      "customer.subscription.deleted",
      subObject({ ...base, status: "canceled", canceledAt: new Date() }),
    ),
  );
  return { ok: true };
}
