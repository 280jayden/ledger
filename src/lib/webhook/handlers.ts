import type Stripe from "stripe";
import { db } from "@/lib/db";
import { isPlanId, type PlanId } from "@/lib/plans";
import { transition, isStatus, type Trigger } from "@/lib/subscription/machine";
import { nextRetry } from "@/lib/billing/retry";
import { chargeKey, isUniqueViolation } from "./dedupe";

// Only the fields we actually read. The full Stripe union drags in a lot of
// shape we never touch and turns every access into a discriminated-union dance.
type SessionLike = {
  id: string;
  customer: string;
  customer_details: { email: string; name: string | null } | null;
  subscription: string | null;
  metadata: { plan?: string };
};

type SubLike = {
  id: string;
  customer: string;
  status: string;
  trial_end: number | null;
  current_period_start: number;
  current_period_end: number;
  cancel_at_period_end: boolean;
  canceled_at: number | null;
  metadata: { plan?: string };
};

type InvoiceLike = {
  id: string;
  customer: string;
  subscription: string | null;
  amount_due: number;
  amount_paid: number;
  currency: string;
  attempt_count: number;
  period_start: number;
  period_end: number;
};

const ts = (s: number) => new Date(s * 1000);

export async function handle(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed":
      return onCheckout(event.data.object as unknown as SessionLike);
    case "customer.subscription.created":
      return onSubCreated(event.data.object as unknown as SubLike, event.id);
    case "customer.subscription.updated":
      return onSubUpdated(event.data.object as unknown as SubLike, event.id);
    case "customer.subscription.deleted":
      return onSubDeleted(event.data.object as unknown as SubLike, event.id);
    case "invoice.payment_succeeded":
      return onPaid(event.data.object as unknown as InvoiceLike, event.id);
    case "invoice.payment_failed":
      return onFailed(event.data.object as unknown as InvoiceLike, event.id);
  }
}

async function move(
  stripeSubscriptionId: string,
  trigger: Trigger,
  eventId: string,
  patch: Record<string, unknown> = {},
) {
  const sub = await db.subscription.findUnique({ where: { stripeSubscriptionId } });
  if (!sub) throw new Error(`no local subscription for ${stripeSubscriptionId}`);
  if (!isStatus(sub.status)) throw new Error(`corrupt status ${sub.status} on ${sub.id}`);

  const m = transition(sub.status, trigger);
  if (!m.ok) {
    // Late or out-of-order delivery. Log the refusal and leave the row alone -
    // forcing the move here is how you end up reviving a canceled subscription.
    await db.transition.create({
      data: {
        subscriptionId: sub.id,
        from: sub.status,
        to: sub.status,
        reason: `rejected ${trigger}: ${m.reason}`,
        eventId,
      },
    });
    return null;
  }

  const updated = await db.subscription.update({
    where: { id: sub.id },
    data: { ...patch, status: m.to },
  });
  await db.transition.create({
    data: { subscriptionId: sub.id, from: m.from, to: m.to, reason: trigger, eventId },
  });
  return updated;
}

async function customerFor(stripeCustomerId: string, email?: string | null, name?: string | null) {
  const found = await db.customer.findUnique({ where: { stripeCustomerId } });
  if (found) return found;
  return db.customer.create({
    data: {
      stripeCustomerId,
      email: email || `${stripeCustomerId}@placeholder.local`,
      name: name ?? null,
    },
  });
}

async function onCheckout(s: SessionLike) {
  await customerFor(s.customer, s.customer_details?.email, s.customer_details?.name ?? null);
}

async function onSubCreated(s: SubLike, eventId: string) {
  const plan = planOf(s);
  const customer = await customerFor(s.customer);
  const existing = await db.subscription.findUnique({ where: { stripeSubscriptionId: s.id } });
  if (existing) return;

  const status = s.trial_end && s.trial_end * 1000 > Date.now() ? "trialing" : "active";
  const created = await db.subscription.create({
    data: {
      stripeSubscriptionId: s.id,
      customerId: customer.id,
      plan,
      status,
      trialEndsAt: s.trial_end ? ts(s.trial_end) : null,
      currentPeriodStart: ts(s.current_period_start),
      currentPeriodEnd: ts(s.current_period_end),
    },
  });
  await db.transition.create({
    data: { subscriptionId: created.id, from: "none", to: status, reason: "created", eventId },
  });
}

async function onSubUpdated(s: SubLike, eventId: string) {
  const local = await db.subscription.findUnique({ where: { stripeSubscriptionId: s.id } });
  if (!local) return onSubCreated(s, eventId);

  const plan = planOf(s);
  if (plan !== local.plan) {
    await db.subscription.update({ where: { id: local.id }, data: { plan } });
    await db.transition.create({
      data: {
        subscriptionId: local.id,
        from: local.status,
        to: local.status,
        reason: `plan ${local.plan} -> ${plan}`,
        eventId,
      },
    });
  }

  if (s.cancel_at_period_end !== local.cancelAtPeriodEnd) {
    await db.subscription.update({
      where: { id: local.id },
      data: { cancelAtPeriodEnd: s.cancel_at_period_end },
    });
  }

  // A period that starts later than the one we hold means Stripe rolled the
  // subscription forward, which is the renewal signal on this event type.
  if (ts(s.current_period_start) > local.currentPeriodStart) {
    await move(s.id, "period_renewed", eventId, {
      currentPeriodStart: ts(s.current_period_start),
      currentPeriodEnd: ts(s.current_period_end),
    });
  }
}

async function onSubDeleted(s: SubLike, eventId: string) {
  await move(s.id, "canceled_by_user", eventId, {
    canceledAt: s.canceled_at ? ts(s.canceled_at) : new Date(),
    cancelAtPeriodEnd: false,
    nextRetryAt: null,
  });
}

async function onPaid(inv: InvoiceLike, eventId: string) {
  const customer = await customerFor(inv.customer);
  const sub = inv.subscription
    ? await db.subscription.findUnique({ where: { stripeSubscriptionId: inv.subscription } })
    : null;

  const invoice = await db.invoice.upsert({
    where: { stripeInvoiceId: inv.id },
    create: {
      stripeInvoiceId: inv.id,
      customerId: customer.id,
      subscriptionId: sub?.id ?? null,
      amountDue: inv.amount_due,
      amountPaid: inv.amount_paid,
      currency: inv.currency,
      status: "paid",
      attemptCount: inv.attempt_count,
      periodStart: ts(inv.period_start),
      periodEnd: ts(inv.period_end),
    },
    update: { amountPaid: inv.amount_paid, status: "paid", attemptCount: inv.attempt_count },
  });

  const applied = await recordCharge({
    key: chargeKey(inv.id, inv.attempt_count),
    stripeChargeId: `ch_${inv.id}_${inv.attempt_count}`,
    customerId: customer.id,
    invoiceId: invoice.id,
    amount: inv.amount_paid,
    currency: inv.currency,
    status: "succeeded",
    description: `invoice ${inv.id} attempt ${inv.attempt_count}`,
  });

  // Already charged for this attempt under a different event id. Bailing here
  // is what stops a replayed payment from re-driving the state machine too.
  if (!applied) return;
  if (!inv.subscription) return;

  await move(inv.subscription, "payment_succeeded", eventId, {
    failedPayments: 0,
    nextRetryAt: null,
    currentPeriodStart: ts(inv.period_start),
    currentPeriodEnd: ts(inv.period_end),
  });
}

async function onFailed(inv: InvoiceLike, eventId: string) {
  const customer = await customerFor(inv.customer);
  const sub = inv.subscription
    ? await db.subscription.findUnique({ where: { stripeSubscriptionId: inv.subscription } })
    : null;

  const invoice = await db.invoice.upsert({
    where: { stripeInvoiceId: inv.id },
    create: {
      stripeInvoiceId: inv.id,
      customerId: customer.id,
      subscriptionId: sub?.id ?? null,
      amountDue: inv.amount_due,
      amountPaid: 0,
      currency: inv.currency,
      status: "open",
      attemptCount: inv.attempt_count,
      periodStart: ts(inv.period_start),
      periodEnd: ts(inv.period_end),
    },
    update: { status: "open", attemptCount: inv.attempt_count },
  });

  const applied = await recordCharge({
    key: chargeKey(inv.id, inv.attempt_count),
    stripeChargeId: `ch_${inv.id}_${inv.attempt_count}`,
    customerId: customer.id,
    invoiceId: invoice.id,
    amount: inv.amount_due,
    currency: inv.currency,
    status: "failed",
    description: `declined on invoice ${inv.id} attempt ${inv.attempt_count}`,
  });
  if (!applied || !sub) return;

  const failures = sub.failedPayments + 1;
  const decision = nextRetry(failures - 1);

  if (decision.action === "give_up") {
    await move(sub.stripeSubscriptionId, "retries_exhausted", eventId, {
      failedPayments: failures,
      nextRetryAt: null,
      canceledAt: new Date(),
    });
    return;
  }

  await move(sub.stripeSubscriptionId, "payment_failed", eventId, {
    failedPayments: failures,
    nextRetryAt: decision.at,
  });
}

type ChargeInput = {
  key: string;
  stripeChargeId: string;
  customerId: string;
  invoiceId: string;
  amount: number;
  currency: string;
  status: string;
  description: string;
};

// False means this attempt was already written. The unique index on
// idempotencyKey does the work; the catch just turns the loser of the race
// into a no-op instead of a 500 that Stripe would retry forever.
async function recordCharge(c: ChargeInput) {
  try {
    await db.charge.create({
      data: {
        stripeChargeId: c.stripeChargeId,
        customerId: c.customerId,
        invoiceId: c.invoiceId,
        amount: c.amount,
        currency: c.currency,
        status: c.status,
        description: c.description,
        idempotencyKey: c.key,
      },
    });
    return true;
  } catch (e) {
    if (isUniqueViolation(e)) return false;
    throw e;
  }
}

function planOf(s: SubLike): PlanId {
  const p = s.metadata?.plan;
  if (!isPlanId(p)) throw new Error(`subscription ${s.id} has no usable plan metadata`);
  return p;
}
