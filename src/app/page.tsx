import PlanPicker from "@/components/PlanPicker";
import { usingStripe } from "@/lib/stripe";

export default function Home() {
  return (
    <main>
      <h1>Billing that survives a bad afternoon</h1>
      <p className="lede">
        Ledger runs subscriptions on Stripe. The interesting part is not the checkout button, it is
        everything after it: duplicate webhooks, payments that land before the subscription they
        belong to, cards that decline on renewal, and plan changes halfway through a billing period.
      </p>

      <hr className="rule" />

      <PlanPicker />

      <hr className="rule" />

      <div className="cols">
        <div>
          <h2>What happens after you click</h2>
          <p className="lede" style={{ marginTop: 8 }}>
            Stripe sends six event types to <span className="id">/api/webhooks/stripe</span>. Every
            delivery has its signature checked, gets claimed against its event id, and is applied
            inside a single transaction. Redeliveries are counted and dropped. A payment that
            arrives out of order fails loudly, and is picked up again on the retry.
          </p>
        </div>
        <div className="panel">
          <header>
            <span className="label">Subscribed events</span>
          </header>
          <div className="body">
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13 }} className="muted">
              <li>checkout.session.completed</li>
              <li>customer.subscription.created</li>
              <li>customer.subscription.updated</li>
              <li>customer.subscription.deleted</li>
              <li>invoice.payment_succeeded</li>
              <li>invoice.payment_failed</li>
            </ul>
          </div>
        </div>
      </div>

      <footer className="page">
        <span>
          {usingStripe
            ? "Running against Stripe test mode."
            : "No Stripe key set, so the local simulator is signing and delivering the events."}
        </span>
        <span className="mono">ledger</span>
      </footer>
    </main>
  );
}
