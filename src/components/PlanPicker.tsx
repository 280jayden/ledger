"use client";

import { useRef, useState } from "react";
import { PLANS, PLAN_IDS, TRIAL_DAYS, type PlanId } from "@/lib/plans";
import { fmt } from "@/lib/money";

export default function PlanPicker() {
  const [plan, setPlan] = useState<PlanId>("growth");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // One key for the life of this form. Double clicking the button sends the
  // same key twice, and the second POST comes back with the first session
  // rather than opening another one.
  const keyRef = useRef<string | null>(null);
  const idempotencyKey = () => (keyRef.current ??= crypto.randomUUID());

  async function start() {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, plan, idempotencyKey: idempotencyKey() }),
    });
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error ?? "checkout failed");
      setBusy(false);
      return;
    }
    window.location.href = data.url;
  }

  return (
    <>
      <div className="plans">
        {PLAN_IDS.map((id) => {
          const p = PLANS[id];
          return (
            <div key={id} className={"plan" + (plan === id ? " picked" : "")}>
              <h2>{p.name}</h2>
              <div className="price">
                {fmt(p.price)}
                <small> / mo</small>
              </div>
              <div className="label">{p.blurb}</div>
              <ul>
                {p.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <button
                onClick={() => setPlan(id)}
                className={plan === id ? "primary" : ""}
                disabled={plan === id}
              >
                {plan === id ? "Selected" : "Select"}
              </button>
            </div>
          );
        })}
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <header>
          <span className="label">Start a {TRIAL_DAYS} day trial</span>
          <span className="label">no card in simulator mode</span>
        </header>
        <div className="body">
          <div className="row">
            <input
              type="email"
              value={email}
              placeholder="you@company.com"
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && start()}
              style={{ minWidth: 260 }}
            />
            <button className="primary" onClick={start} disabled={busy || !email}>
              {busy ? "Working" : `Start on ${PLANS[plan].name}`}
            </button>
            <span className="muted" style={{ fontSize: 13 }}>
              {fmt(PLANS[plan].price)}/mo after the trial
            </span>
          </div>
          {err && <div className="err">{err}</div>}
          <p className="note">
            Checkout is keyed on a client generated idempotency key. Submitting twice returns the
            original session, so a jumpy connection cannot open two subscriptions on one card.
          </p>
        </div>
      </div>
    </>
  );
}
