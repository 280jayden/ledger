import { describe, expect, it } from "vitest";
import { transition, canTransition, type Status } from "@/lib/subscription/machine";
import { nextRetry, MAX_ATTEMPTS, RETRY_OFFSETS_H } from "@/lib/billing/retry";

function to(from: Status, trigger: Parameters<typeof transition>[1]) {
  const m = transition(from, trigger);
  if (!m.ok) throw new Error(m.reason);
  return m.to;
}

describe("subscription lifecycle", () => {
  it("1. converts a trial to active on the first successful payment", () => {
    expect(to("trialing", "payment_succeeded")).toBe("active");
  });

  it("2. drops a trial that never pays into past_due, not canceled", () => {
    expect(to("trialing", "trial_expired_unpaid")).toBe("past_due");
  });

  it("3. cancels straight out of a trial without passing through past_due", () => {
    expect(to("trialing", "canceled_by_user")).toBe("canceled");
  });

  it("4. moves active to past_due when the renewal card declines", () => {
    expect(to("active", "payment_failed")).toBe("past_due");
  });

  it("5. recovers past_due to active when a retry finally clears", () => {
    expect(to("past_due", "payment_succeeded")).toBe("active");
  });

  it("6. keeps repeated declines in past_due instead of thrashing state", () => {
    let s: Status = "active";
    s = to(s, "payment_failed");
    for (let i = 0; i < 5; i++) s = to(s, "payment_failed");
    expect(s).toBe("past_due");
  });

  it("7. cancels once the retry schedule is exhausted", () => {
    expect(to("past_due", "retries_exhausted")).toBe("canceled");
  });

  it("8. treats a renewal on an active sub as a self loop, flagged noop", () => {
    const m = transition("active", "period_renewed");
    expect(m).toMatchObject({ ok: true, to: "active", noop: true });
  });

  it("9. refuses a late payment_succeeded that lands after cancellation", () => {
    const m = transition("canceled", "payment_succeeded");
    expect(m.ok).toBe(false);
    expect(canTransition("canceled", "payment_succeeded")).toBe(false);
  });

  it("10. refuses a second cancel rather than re-entering canceled", () => {
    expect(transition("canceled", "canceled_by_user").ok).toBe(false);
  });

  it("11. sends a trial straight to past_due if the very first charge declines", () => {
    expect(to("trialing", "payment_failed")).toBe("past_due");
  });

  it("12. will not let retries_exhausted fire from active, only from past_due", () => {
    expect(transition("active", "retries_exhausted").ok).toBe(false);
    expect(transition("past_due", "retries_exhausted").ok).toBe(true);
  });
});

describe("dunning", () => {
  it("spaces retries on the configured schedule", () => {
    const t0 = new Date("2026-03-01T00:00:00Z");
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const d = nextRetry(i, t0);
      expect(d.action).toBe("retry");
      if (d.action !== "retry") return;
      expect(d.at.getTime() - t0.getTime()).toBe(RETRY_OFFSETS_H[i] * 3600_000);
    }
  });

  it("gives up after the last attempt", () => {
    expect(nextRetry(MAX_ATTEMPTS).action).toBe("give_up");
    expect(nextRetry(MAX_ATTEMPTS + 4).action).toBe("give_up");
  });
});
