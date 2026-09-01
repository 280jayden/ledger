export type PlanId = "starter" | "growth" | "scale";

export type Plan = {
  id: PlanId;
  name: string;
  price: number; // cents per month
  seats: number;
  blurb: string;
  features: string[];
};

export const TRIAL_DAYS = 14;

export const PLANS: Record<PlanId, Plan> = {
  starter: {
    id: "starter",
    name: "Starter",
    price: 1200,
    seats: 3,
    blurb: "For a single project and a small team.",
    features: ["3 seats", "10k events / mo", "30 day retention", "Email support"],
  },
  growth: {
    id: "growth",
    name: "Growth",
    price: 3900,
    seats: 15,
    blurb: "Usage limits that stop getting in the way.",
    features: ["15 seats", "250k events / mo", "1 year retention", "Webhook replay", "Priority support"],
  },
  scale: {
    id: "scale",
    name: "Scale",
    price: 9900,
    seats: 100,
    blurb: "Volume pricing, audit trail, and an SLA.",
    features: ["100 seats", "5M events / mo", "Unlimited retention", "Audit log export", "99.9% SLA"],
  },
};

export const PLAN_IDS = Object.keys(PLANS) as PlanId[];

export function isPlanId(v: unknown): v is PlanId {
  return typeof v === "string" && v in PLANS;
}

export function planRank(id: PlanId) {
  return PLAN_IDS.indexOf(id);
}
