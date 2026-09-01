// Dunning schedule, in hours after each failed attempt. Mirrors Stripe's
// default smart-retry spacing closely enough that our local state matches
// what Stripe would do on its own cadence.
export const RETRY_OFFSETS_H = [24, 72, 120];

export const MAX_ATTEMPTS = RETRY_OFFSETS_H.length;

export type RetryDecision =
  | { action: "retry"; attempt: number; at: Date }
  | { action: "give_up"; attempt: number };

export function nextRetry(failures: number, from = new Date()): RetryDecision {
  if (failures >= MAX_ATTEMPTS) return { action: "give_up", attempt: failures };
  const h = RETRY_OFFSETS_H[failures];
  return {
    action: "retry",
    attempt: failures + 1,
    at: new Date(from.getTime() + h * 3600_000),
  };
}
