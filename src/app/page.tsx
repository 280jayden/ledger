import PlanPicker from "@/components/PlanPicker";
import { usingStripe, HANDLED } from "@/lib/stripe";

export default function Home() {
  return (
    <main>
      <h1>
        Billing that survives
        <br />a bad afternoon
      </h1>
      <p className="lede">
        Ledger runs subscriptions on Stripe. The interesting part is not the checkout button, it is
        everything after it: duplicate webhooks, payments that land before the subscription they
        belong to, cards that decline on renewal, and plan changes made halfway through a period.
      </p>

      <hr className="rule" />

      <PlanPicker />

      <div className="section">
        <div className="head">
          <h2>What happens after you click</h2>
          <span className="label">/api/webhooks/stripe</span>
        </div>
        <div className="cols" style={{ marginTop: 18, gap: 46 }}>
          <p className="muted" style={{ margin: 0, maxWidth: "56ch" }}>
            Stripe sends six event types. Every delivery has its signature checked, gets claimed
            against its event id, and is applied inside a single transaction. Redeliveries are
            counted and dropped before they reach a handler. A payment that arrives out of order
            fails loudly and is picked up again on the retry, and because the write rolls back with
            it there is nothing half finished to trip over.
          </p>
          <ul className="eventlist">
            {HANDLED.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      </div>

      <footer className="page">
        <span>
          {usingStripe
            ? "Running against Stripe test mode."
            : "No Stripe key is set, so the local simulator is signing and delivering the events."}
        </span>
        <span className="mono">ledger</span>
      </footer>
    </main>
  );
}
