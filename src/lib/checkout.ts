import { db } from "@/lib/db";
import { TRIAL_DAYS, type PlanId } from "@/lib/plans";
import { stripe, usingStripe, APP_URL } from "@/lib/stripe";
import { isUniqueViolation } from "@/lib/webhook/dedupe";
import { deliver, makeEvent, simId, subObject } from "@/lib/sim/events";

export type CheckoutResult =
  | { ok: true; sessionId: string; url: string; replayed: boolean }
  | { ok: false; error: string };

const priceEnv = (plan: PlanId) => process.env[`STRIPE_PRICE_${plan.toUpperCase()}`];

export async function createCheckout(input: {
  email: string;
  name?: string | null;
  plan: PlanId;
  idempotencyKey: string;
}): Promise<CheckoutResult> {
  const { email, name, plan, idempotencyKey: key } = input;

  // Claim the key first. A retried POST - double click, flaky network, a client
  // that resends on timeout - loses this insert and gets the original session
  // back instead of opening a second one against the same card.
  try {
    await db.idempotencyRecord.create({ data: { key, scope: "checkout.create" } });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const prior = await db.idempotencyRecord.findUnique({ where: { key } });
    if (!prior?.result) return { ok: false, error: "a checkout with this key is still in flight" };
    return { ok: true, sessionId: prior.result, url: doneUrl(prior.result), replayed: true };
  }

  const result = usingStripe
    ? await liveCheckout(email, plan, key)
    : await simCheckout(email, name ?? null, plan);

  if (result.ok) {
    await db.idempotencyRecord.update({ where: { key }, data: { result: result.sessionId } });
  } else {
    await db.idempotencyRecord.delete({ where: { key } });
  }
  return result;
}

async function liveCheckout(email: string, plan: PlanId, key: string): Promise<CheckoutResult> {
  const price = priceEnv(plan);
  if (!price) return { ok: false, error: `set STRIPE_PRICE_${plan.toUpperCase()} to use live mode` };

  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      customer_email: email,
      line_items: [{ price, quantity: 1 }],
      subscription_data: { trial_period_days: TRIAL_DAYS, metadata: { plan } },
      metadata: { plan },
      success_url: `${APP_URL}/checkout/done?session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/`,
    },
    { idempotencyKey: key },
  );

  return { ok: true, sessionId: session.id, url: session.url ?? doneUrl(session.id), replayed: false };
}

async function simCheckout(
  email: string,
  name: string | null,
  plan: PlanId,
): Promise<CheckoutResult> {
  const existing = await db.customer.findUnique({ where: { email } });
  const customerId = existing?.stripeCustomerId ?? simId("cus");
  const sessionId = simId("cs");
  const subId = simId("sub");

  const now = new Date();
  const trialEnd = new Date(now.getTime() + TRIAL_DAYS * 86400_000);

  await deliver(
    makeEvent("checkout.session.completed", {
      id: sessionId,
      object: "checkout.session",
      customer: customerId,
      customer_details: { email, name },
      subscription: subId,
      metadata: { plan },
    }),
  );

  await deliver(
    makeEvent(
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
    ),
  );

  return { ok: true, sessionId, url: doneUrl(sessionId), replayed: false };
}

function doneUrl(sessionId: string) {
  return `${APP_URL}/checkout/done?session=${sessionId}`;
}
