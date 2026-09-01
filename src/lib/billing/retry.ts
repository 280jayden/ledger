// Hours to wait before each retry that follows a declined payment. Mirrors
// Stripe's default smart-retry spacing closely enough that our local dunning
// state stays in step with the attempts Stripe makes on its own.
export const RETRY_OFFSETS_H = [24, 72, 120];

export const MAX_RETRIES = RETRY_OFFSETS_H.length;

// The first decline is an attempt too, so a subscription burns through four
// failed charges before it gets canceled, not three.
export const TOTAL_ATTEMPTS = MAX_RETRIES + 1;

export type RetryDecision =
  | { action: "retry"; attempt: number; at: Date }
  | { action: "give_up"; attempt: number };

export function nextRetry(retriesUsed: number, from = new Date()): RetryDecision {
  if (retriesUsed >= MAX_RETRIES) return { action: "give_up", attempt: retriesUsed + 1 };
  return {
    action: "retry",
    attempt: retriesUsed + 1,
    at: new Date(from.getTime() + RETRY_OFFSETS_H[retriesUsed] * 3600_000),
  };
}
