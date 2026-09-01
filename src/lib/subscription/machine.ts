export type Status = "trialing" | "active" | "past_due" | "canceled";

export type Trigger =
  | "payment_succeeded"
  | "payment_failed"
  | "period_renewed"
  | "trial_expired_unpaid"
  | "retries_exhausted"
  | "canceled_by_user";

export const TERMINAL: Status[] = ["canceled"];

// Every legal move, keyed by the status we're in. Anything missing from a row
// is rejected rather than silently ignored - a webhook that implies an illegal
// move almost always means we processed events out of order.
const TABLE: Record<Status, Partial<Record<Trigger, Status>>> = {
  trialing: {
    payment_succeeded: "active",
    payment_failed: "past_due",
    trial_expired_unpaid: "past_due",
    canceled_by_user: "canceled",
  },
  active: {
    payment_succeeded: "active",
    period_renewed: "active",
    payment_failed: "past_due",
    canceled_by_user: "canceled",
  },
  past_due: {
    payment_succeeded: "active",
    payment_failed: "past_due",
    retries_exhausted: "canceled",
    canceled_by_user: "canceled",
  },
  canceled: {},
};

export type Move =
  | { ok: true; from: Status; to: Status; trigger: Trigger; noop: boolean }
  | { ok: false; from: Status; trigger: Trigger; reason: string };

export function transition(from: Status, trigger: Trigger): Move {
  if (TERMINAL.includes(from)) {
    return { ok: false, from, trigger, reason: `${from} is terminal` };
  }
  const to = TABLE[from][trigger];
  if (!to) {
    return { ok: false, from, trigger, reason: `${trigger} is not legal from ${from}` };
  }
  return { ok: true, from, to, trigger, noop: to === from };
}

export function canTransition(from: Status, trigger: Trigger) {
  return transition(from, trigger).ok;
}

export function isStatus(v: unknown): v is Status {
  return v === "trialing" || v === "active" || v === "past_due" || v === "canceled";
}
