import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { PLANS } from "@/lib/plans";
import { TOTAL_ATTEMPTS } from "@/lib/billing/retry";
import { deliver, deliverRaw, makeEvent, simId, invoiceObject } from "@/lib/sim/events";
import { sign } from "@/lib/webhook/receive";
import { chargedTotal, fixture, reset, rng, shuffle } from "./helpers";

const RUNS = 200;

beforeAll(reset);

describe("signature verification", () => {
  it("accepts a correctly signed payload", async () => {
    const f = fixture();
    const raw = JSON.stringify(f.created);
    const r = await deliverRaw(raw, sign(raw));
    expect(r.status).toBe("processed");
  });

  it("rejects a payload signed with the wrong secret", async () => {
    const f = fixture();
    const raw = JSON.stringify(f.created);
    const bad = sign(raw).replace(/v1=[0-9a-f]+/, "v1=" + "0".repeat(64));
    const r = await deliverRaw(raw, bad);
    expect(r.status).toBe("invalid_signature");
  });

  it("rejects a body that was altered after signing", async () => {
    const f = fixture();
    const raw = JSON.stringify(f.created);
    const sig = sign(raw);
    const r = await deliverRaw(raw.replace(/"status":"trialing"/, '"status":"active"'), sig);
    expect(r.status).toBe("invalid_signature");
  });

  it("rejects a replay from outside the timestamp tolerance", async () => {
    const f = fixture();
    const raw = JSON.stringify(f.created);
    const old = Math.floor(Date.now() / 1000) - 3600;
    const r = await deliverRaw(raw, sign(raw, old));
    expect(r.status).toBe("invalid_signature");
  });

  it("rejects a delivery with no signature header at all", async () => {
    const f = fixture();
    const r = await deliverRaw(JSON.stringify(f.created), null);
    expect(r.status).toBe("invalid_signature");
  });

  it("does not write anything for a rejected delivery", async () => {
    const f = fixture();
    const raw = JSON.stringify(f.created);
    await deliverRaw(raw, "t=1,v1=deadbeef");
    expect(await db.webhookEvent.findUnique({ where: { id: f.created.id } })).toBeNull();
  });
});

describe("dedupe", () => {
  it("marks the second delivery of an event id as a duplicate", async () => {
    const f = fixture();
    expect((await deliver(f.created)).status).toBe("processed");
    const second = await deliver(f.created);
    expect(second.status).toBe("duplicate");
    if (second.status === "duplicate") expect(second.deliveries).toBe(2);
  });

  it("counts every redelivery without ever re-running the handler", async () => {
    const f = fixture();
    await deliver(f.created);
    await deliver(f.paid);
    for (let i = 0; i < 9; i++) await deliver(f.paid);

    const row = await db.webhookEvent.findUniqueOrThrow({ where: { id: f.paid.id } });
    expect(row.deliveries).toBe(10);
    expect(row.status).toBe("processed");
    expect(await chargedTotal(f.customerId)).toBe(PLANS[f.plan].price);
  });

  it("catches a repeat of the same payment arriving under a fresh event id", async () => {
    const f = fixture();
    await deliver(f.created);
    await deliver(f.paid);
    const again = await deliver(f.paidUnderNewEventId);

    // The event itself is new, so it processes - but the charge does not.
    expect(again.status).toBe("processed");
    expect(await chargedTotal(f.customerId)).toBe(PLANS[f.plan].price);

    const charges = await db.charge.findMany({ where: { idempotencyKey: `${f.invoiceId}:1` } });
    expect(charges).toHaveLength(1);
  });

  it("retries an event whose first attempt failed", async () => {
    const f = fixture();
    // Payment before creation: there is no subscription to move yet.
    const first = await deliver(f.paid);
    expect(first.status).toBe("failed");

    await deliver(f.created);
    const retry = await deliver(f.paid);
    expect(retry.status).toBe("processed");

    const sub = await db.subscription.findUniqueOrThrow({
      where: { stripeSubscriptionId: f.subId },
    });
    expect(sub.status).toBe("active");
    expect(await chargedTotal(f.customerId)).toBe(PLANS[f.plan].price);
  });

  it("ignores event types it does not handle instead of failing them", async () => {
    const e = makeEvent("payment_intent.created", { id: simId("pi"), object: "payment_intent" });
    expect((await deliver(e)).status).toBe("ignored");
  });
});

describe(`retry storms (${RUNS} runs)`, () => {
  it("never double charges, whatever order the duplicates land in", async () => {
    const before = await db.charge.count({ where: { status: "succeeded" } });
    const bad: string[] = [];

    for (let run = 0; run < RUNS; run++) {
      const rand = rng(run + 1);
      const f = fixture();
      const expected = PLANS[f.plan].price;

      // Stripe redelivers on any non-2xx and does not promise ordering, so the
      // storm is every event two to four times over, shuffled together, with
      // one copy of the payment wearing a different event id.
      const storm = [f.created, f.paid, f.paidUnderNewEventId].flatMap((e) =>
        Array.from({ length: 2 + Math.floor(rand() * 3) }, () => e),
      );

      for (const e of shuffle(storm, rand)) await deliver(e);

      // Whatever failed on arrival gets one more pass, same as Stripe backing
      // off and trying again once the ordering has settled.
      for (const e of [f.created, f.paid, f.paidUnderNewEventId]) await deliver(e);

      const total = await chargedTotal(f.customerId);
      const sub = await db.subscription.findUnique({ where: { stripeSubscriptionId: f.subId } });
      if (total !== expected || sub?.status !== "active") {
        bad.push(`run ${run}: charged ${total} (want ${expected}), status ${sub?.status}`);
      }
    }

    expect(bad).toEqual([]);

    const after = await db.charge.count({ where: { status: "succeeded" } });
    expect(after - before).toBe(RUNS);
  });
});

describe("dunning", () => {
  it("walks past_due through the retry schedule and cancels when it runs out", async () => {
    const f = fixture("starter");
    await deliver(f.created);

    const invId = simId("in");
    const start = new Date();
    const end = new Date(start.getTime() + 30 * 86400_000);
    const bill = (attempt: number, ok: boolean) =>
      deliver(
        makeEvent(
          ok ? "invoice.payment_succeeded" : "invoice.payment_failed",
          invoiceObject({
            id: invId,
            customer: f.customerId,
            subscription: f.subId,
            amount: PLANS.starter.price,
            paid: ok ? PLANS.starter.price : 0,
            attempt,
            periodStart: start,
            periodEnd: end,
          }),
        ),
      );

    await bill(1, false);
    let sub = await db.subscription.findUniqueOrThrow({
      where: { stripeSubscriptionId: f.subId },
    });
    expect(sub.status).toBe("past_due");
    expect(sub.nextRetryAt).not.toBeNull();

    for (let attempt = 2; attempt <= TOTAL_ATTEMPTS; attempt++) await bill(attempt, false);

    sub = await db.subscription.findUniqueOrThrow({ where: { stripeSubscriptionId: f.subId } });
    expect(sub.status).toBe("canceled");
    expect(sub.failedPayments).toBe(TOTAL_ATTEMPTS);
    expect(sub.nextRetryAt).toBeNull();
    expect(await chargedTotal(f.customerId)).toBe(0);
  });

  it("recovers to active when a retry finally clears", async () => {
    const f = fixture("starter");
    await deliver(f.created);

    const invId = simId("in");
    const start = new Date();
    const end = new Date(start.getTime() + 30 * 86400_000);
    const bill = (attempt: number, ok: boolean) =>
      deliver(
        makeEvent(
          ok ? "invoice.payment_succeeded" : "invoice.payment_failed",
          invoiceObject({
            id: invId,
            customer: f.customerId,
            subscription: f.subId,
            amount: PLANS.starter.price,
            paid: ok ? PLANS.starter.price : 0,
            attempt,
            periodStart: start,
            periodEnd: end,
          }),
        ),
      );

    await bill(1, false);
    await bill(2, true);

    const sub = await db.subscription.findUniqueOrThrow({
      where: { stripeSubscriptionId: f.subId },
    });
    expect(sub.status).toBe("active");
    expect(sub.failedPayments).toBe(0);
    expect(sub.nextRetryAt).toBeNull();
    expect(await chargedTotal(f.customerId)).toBe(PLANS.starter.price);
  });
});
