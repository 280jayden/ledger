import { db } from "@/lib/db";
import { PLANS, TRIAL_DAYS, type PlanId } from "@/lib/plans";
import { makeEvent, simId, subObject, invoiceObject, type SimEvent } from "@/lib/sim/events";

export async function reset() {
  await db.$executeRawUnsafe("DELETE FROM Charge");
  await db.$executeRawUnsafe("DELETE FROM Invoice");
  await db.$executeRawUnsafe("DELETE FROM `Transition`");
  await db.$executeRawUnsafe("DELETE FROM Subscription");
  await db.$executeRawUnsafe("DELETE FROM Customer");
  await db.$executeRawUnsafe("DELETE FROM WebhookEvent");
  await db.$executeRawUnsafe("DELETE FROM IdempotencyRecord");
}

const MONTH = 30 * 86400_000;

export type Fixture = {
  customerId: string;
  subId: string;
  invoiceId: string;
  plan: PlanId;
  created: SimEvent;
  paid: SimEvent;
  // Same invoice and same attempt as `paid`, but a different event id. Event-id
  // dedupe can't catch this one - only the charge idempotency key can.
  paidUnderNewEventId: SimEvent;
};

export function fixture(plan: PlanId = "growth", now = new Date()): Fixture {
  const customerId = simId("cus");
  const subId = simId("sub");
  const invoiceId = simId("in");
  const trialEnd = new Date(now.getTime() + TRIAL_DAYS * 86400_000);

  const created = makeEvent(
    "customer.subscription.created",
    subObject({
      id: subId,
      customer: customerId,
      plan,
      status: "trialing",
      trialEnd,
      periodStart: now,
      periodEnd: trialEnd,
    }),
  );

  const invoice = invoiceObject({
    id: invoiceId,
    customer: customerId,
    subscription: subId,
    amount: PLANS[plan].price,
    paid: PLANS[plan].price,
    attempt: 1,
    periodStart: trialEnd,
    periodEnd: new Date(trialEnd.getTime() + MONTH),
  });

  return {
    customerId,
    subId,
    invoiceId,
    plan,
    created,
    paid: makeEvent("invoice.payment_succeeded", invoice),
    paidUnderNewEventId: makeEvent("invoice.payment_succeeded", invoice),
  };
}

// Deterministic PRNG so a failing run is reproducible from its seed.
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function shuffle<T>(items: T[], rand: () => number) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function chargedTotal(stripeCustomerId: string) {
  const customer = await db.customer.findUnique({ where: { stripeCustomerId } });
  if (!customer) return 0;
  const rows = await db.charge.findMany({
    where: { customerId: customer.id, status: "succeeded" },
  });
  return rows.reduce((n, c) => n + c.amount, 0);
}
