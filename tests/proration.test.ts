import { describe, expect, it } from "vitest";
import { prorate } from "@/lib/billing/proration";
import { PLANS } from "@/lib/plans";

const start = new Date("2026-03-01T00:00:00Z");
const end = new Date("2026-03-31T00:00:00Z");
const mid = new Date("2026-03-16T00:00:00Z");

describe("proration", () => {
  it("charges the difference for an upgrade at the halfway mark", () => {
    const p = prorate("starter", "growth", start, end, mid);
    expect(p.ratio).toBeCloseTo(0.5, 6);
    expect(p.unusedCredit).toBe(Math.floor(PLANS.starter.price / 2));
    expect(p.newCharge).toBe(Math.floor(PLANS.growth.price / 2));
    expect(p.dueNow).toBe(p.newCharge - p.unusedCredit);
    expect(p.dueNow).toBeGreaterThan(0);
  });

  it("produces a credit, not a charge, on a downgrade", () => {
    const p = prorate("scale", "starter", start, end, mid);
    expect(p.dueNow).toBeLessThan(0);
  });

  it("charges the full new plan when the change lands on the period start", () => {
    const p = prorate("starter", "scale", start, end, start);
    expect(p.ratio).toBe(1);
    expect(p.newCharge).toBe(PLANS.scale.price);
    expect(p.unusedCredit).toBe(PLANS.starter.price);
  });

  it("charges nothing when the change lands on the period end", () => {
    const p = prorate("starter", "scale", start, end, end);
    expect(p.ratio).toBe(0);
    expect(p.dueNow).toBe(0);
  });

  it("clamps a change requested outside the period instead of going negative", () => {
    const before = prorate("starter", "growth", start, end, new Date("2026-02-01T00:00:00Z"));
    const after = prorate("starter", "growth", start, end, new Date("2026-05-01T00:00:00Z"));
    expect(before.ratio).toBe(1);
    expect(after.ratio).toBe(0);
    expect(after.remainingMs).toBe(0);
  });

  it("nets to zero when the plan does not actually change", () => {
    const p = prorate("growth", "growth", start, end, mid);
    expect(p.dueNow).toBe(0);
  });
});
