import { PLANS, type PlanId } from "@/lib/plans";

export type Proration = {
  from: PlanId;
  to: PlanId;
  unusedCredit: number; // cents credited back for time not used on old plan
  newCharge: number; // cents charged for remainder of period on new plan
  dueNow: number; // net, negative means credit carried to next invoice
  remainingMs: number;
  periodMs: number;
  ratio: number;
};

// Stripe prorates on elapsed wall-clock time in the period, not on calendar
// days, and truncates each leg to whole cents independently. Doing the same
// here keeps our preview matching the invoice Stripe actually issues.
export function prorate(
  from: PlanId,
  to: PlanId,
  periodStart: Date,
  periodEnd: Date,
  at = new Date(),
): Proration {
  const periodMs = periodEnd.getTime() - periodStart.getTime();
  const clamped = Math.min(Math.max(at.getTime(), periodStart.getTime()), periodEnd.getTime());
  const remainingMs = periodEnd.getTime() - clamped;
  const ratio = periodMs <= 0 ? 0 : remainingMs / periodMs;

  const unusedCredit = Math.floor(PLANS[from].price * ratio);
  const newCharge = Math.floor(PLANS[to].price * ratio);

  return {
    from,
    to,
    unusedCredit,
    newCharge,
    dueNow: newCharge - unusedCredit,
    remainingMs,
    periodMs,
    ratio,
  };
}
