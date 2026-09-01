import { randomUUID } from "node:crypto";
import { receive, sign, type ReceiveResult } from "@/lib/webhook/receive";

export function simId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export const secs = (d: Date) => Math.floor(d.getTime() / 1000);

export type SimEvent = {
  id: string;
  object: "event";
  api_version: string;
  created: number;
  livemode: false;
  type: string;
  data: { object: Record<string, unknown> };
};

export function makeEvent(
  type: string,
  object: Record<string, unknown>,
  id = simId("evt"),
): SimEvent {
  return {
    id,
    object: "event",
    api_version: "2025-02-24.acacia",
    created: secs(new Date()),
    livemode: false,
    type,
    data: { object },
  };
}

// Signed with the same secret a real endpoint uses, so this goes through
// stripe.webhooks.constructEvent exactly like a delivery from Stripe would.
export async function deliver(event: SimEvent): Promise<ReceiveResult> {
  const raw = JSON.stringify(event);
  return receive(raw, sign(raw));
}

export async function deliverRaw(raw: string, signature: string | null) {
  return receive(raw, signature);
}

export function subObject(o: {
  id: string;
  customer: string;
  plan: string;
  status: string;
  trialEnd: Date | null;
  periodStart: Date;
  periodEnd: Date;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: Date | null;
}) {
  return {
    id: o.id,
    object: "subscription",
    customer: o.customer,
    status: o.status,
    trial_end: o.trialEnd ? secs(o.trialEnd) : null,
    current_period_start: secs(o.periodStart),
    current_period_end: secs(o.periodEnd),
    cancel_at_period_end: o.cancelAtPeriodEnd ?? false,
    canceled_at: o.canceledAt ? secs(o.canceledAt) : null,
    metadata: { plan: o.plan },
  };
}

export function invoiceObject(o: {
  id: string;
  customer: string;
  subscription: string | null;
  amount: number;
  paid: number;
  attempt: number;
  periodStart: Date;
  periodEnd: Date;
}) {
  return {
    id: o.id,
    object: "invoice",
    customer: o.customer,
    subscription: o.subscription,
    amount_due: o.amount,
    amount_paid: o.paid,
    currency: "usd",
    attempt_count: o.attempt,
    period_start: secs(o.periodStart),
    period_end: secs(o.periodEnd),
  };
}
