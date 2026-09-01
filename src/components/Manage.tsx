"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PLANS, PLAN_IDS, type PlanId } from "@/lib/plans";
import { fmt, fmtDelta } from "@/lib/money";

type Preview = { unusedCredit: number; newCharge: number; dueNow: number; ratio: number };

export default function Manage({
  subscriptionId,
  plan,
  status,
  simulated,
}: {
  subscriptionId: string;
  plan: PlanId;
  status: string;
  simulated: boolean;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<PlanId>(plan);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const keys = useRef(new Map<string, string>());
  const keyFor = (op: string) => {
    if (!keys.current.has(op)) keys.current.set(op, crypto.randomUUID());
    return keys.current.get(op)!;
  };

  const done = keys.current;
  const canceled = status === "canceled";

  async function pick(next: PlanId) {
    setTarget(next);
    setPreview(null);
    setErr(null);
    if (next === plan) return;
    const res = await fetch(`/api/subscription/${subscriptionId}/preview?to=${next}`);
    if (res.ok) setPreview(await res.json());
  }

  async function post(url: string, body: unknown) {
    setBusy(true);
    setErr(null);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      setErr((await res.json()).error ?? "that did not work");
      return false;
    }
    setPreview(null);
    router.refresh();
    return true;
  }

  const apply = () =>
    post(`/api/subscription/${subscriptionId}/plan`, {
      plan: target,
      idempotencyKey: keyFor(`plan:${target}`),
    });

  const sim = (action: string) => post("/api/sim", { subscriptionId, action });

  return (
    <div className="stack">
      <div className="panel">
        <header>
          <span className="label">Change plan</span>
          <span className="label">prorated to the day</span>
        </header>
        <div className="body">
          <div className="row">
            <select
              value={target}
              disabled={canceled}
              onChange={(e) => pick(e.target.value as PlanId)}
            >
              {PLAN_IDS.map((id) => (
                <option key={id} value={id}>
                  {PLANS[id].name} — {fmt(PLANS[id].price)}/mo
                </option>
              ))}
            </select>
            <button
              className="primary"
              disabled={busy || canceled || target === plan}
              onClick={apply}
            >
              Apply
            </button>
          </div>

          {preview && (
            <dl className="kv" style={{ marginTop: 14 }}>
              <dt>Unused</dt>
              <dd className="num">{fmtDelta(-preview.unusedCredit)}</dd>
              <dt>New plan</dt>
              <dd className="num">{fmtDelta(preview.newCharge)}</dd>
              <dt>Due now</dt>
              <dd className="num" style={{ fontWeight: 600 }}>
                {preview.dueNow >= 0 ? fmt(preview.dueNow) : `${fmt(-preview.dueNow)} credit`}
              </dd>
              <dt>Period left</dt>
              <dd className="num">{Math.round(preview.ratio * 100)}%</dd>
            </dl>
          )}

          {err && <div className="err">{err}</div>}
        </div>
      </div>

      {simulated && !canceled && (
        <div className="panel">
          <header>
            <span className="label">Drive the billing clock</span>
            <span className="mode">simulator</span>
          </header>
          <div className="body">
            <div className="row">
              {status === "trialing" && (
                <>
                  <button disabled={busy} onClick={() => sim("trial_paid")}>
                    End trial, card clears
                  </button>
                  <button disabled={busy} onClick={() => sim("trial_declined")}>
                    End trial, card declines
                  </button>
                </>
              )}
              {status === "active" && (
                <>
                  <button disabled={busy} onClick={() => sim("renew_paid")}>
                    Renew
                  </button>
                  <button disabled={busy} onClick={() => sim("renew_declined")}>
                    Renew, card declines
                  </button>
                </>
              )}
              {status === "past_due" && (
                <>
                  <button disabled={busy} onClick={() => sim("retry_paid")}>
                    Retry, clears
                  </button>
                  <button disabled={busy} onClick={() => sim("retry_declined")}>
                    Retry, declines again
                  </button>
                </>
              )}
            </div>
            <p className="note">
              Each button signs a Stripe shaped event and posts it through the same webhook path a
              real delivery takes. Nothing here writes to the database directly.
            </p>
          </div>
        </div>
      )}

      <div className="panel">
        <header>
          <span className="label">Cancel</span>
        </header>
        <div className="body">
          <div className="row">
            <button
              disabled={busy || canceled}
              onClick={() =>
                post(`/api/subscription/${subscriptionId}/cancel`, { atPeriodEnd: true })
              }
            >
              At period end
            </button>
            <button
              className="danger"
              disabled={busy || canceled}
              onClick={() =>
                post(`/api/subscription/${subscriptionId}/cancel`, { atPeriodEnd: false })
              }
            >
              Immediately
            </button>
          </div>
          {done.size > 0 && (
            <p className="note">
              {done.size} idempotency {done.size === 1 ? "key" : "keys"} issued this session.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
