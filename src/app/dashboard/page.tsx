import Link from "next/link";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { PLANS, isPlanId } from "@/lib/plans";
import { fmt } from "@/lib/money";
import { short, stamp, untilDays } from "@/lib/dates";
import { usingStripe } from "@/lib/stripe";
import { TOTAL_ATTEMPTS } from "@/lib/billing/retry";
import Manage from "@/components/Manage";

export const dynamic = "force-dynamic";

const STAGES = ["trialing", "active", "past_due", "canceled"] as const;

const TONE: Record<string, string> = {
  trialing: "accent",
  active: "ok",
  past_due: "warn",
  canceled: "bad",
  paid: "ok",
  open: "warn",
  succeeded: "ok",
  failed: "bad",
};

export default async function Dashboard() {
  const email = (await cookies()).get("ledger_customer")?.value;

  const customer = email
    ? await db.customer.findUnique({
        where: { email },
        include: {
          subscriptions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: {
              transitions: { orderBy: { at: "desc" }, take: 14 },
              invoices: { orderBy: { createdAt: "desc" } },
            },
          },
        },
      })
    : null;

  const sub = customer?.subscriptions[0];

  if (!customer || !sub || !isPlanId(sub.plan)) {
    return (
      <main>
        <h1>No subscription yet</h1>
        <p className="lede">
          Start a trial from the <Link href="/">plans page</Link> and this becomes the operator view
          for it: current state, every transition that got you there, invoices, and the controls to
          upgrade or cancel.
        </p>
      </main>
    );
  }

  const charges = await db.charge.findMany({
    where: { customerId: customer.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const collected = charges
    .filter((c) => c.status === "succeeded")
    .reduce((n, c) => n + c.amount, 0);

  const reached = STAGES.indexOf(sub.status as (typeof STAGES)[number]);

  return (
    <main>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>{customer.email}</h1>
        <span className="id">{sub.stripeSubscriptionId}</span>
      </div>

      <div className="machine" style={{ margin: "18px 0 26px" }}>
        {STAGES.map((s, i) => (
          <span key={s} style={{ display: "flex", alignItems: "center" }}>
            {i > 0 && <span className="link" />}
            <span
              className={"node" + (s === sub.status ? " on" : i < reached ? " done" : "")}
              title={s === sub.status ? "current state" : undefined}
            >
              {s.replace("_", " ")}
            </span>
          </span>
        ))}
      </div>

      <div className="cols">
        <div className="stack">
          <div className="panel">
            <header>
              <span className="label">Subscription</span>
              <span className={"pill " + (TONE[sub.status] ?? "")}>{sub.status}</span>
            </header>
            <div className="body">
              <dl className="kv">
                <dt>Plan</dt>
                <dd>
                  {PLANS[sub.plan].name} <span className="muted">— {fmt(PLANS[sub.plan].price)}/mo</span>
                </dd>
                <dt>Period</dt>
                <dd className="num">
                  {short(sub.currentPeriodStart)} <span className="arrow">→</span>{" "}
                  {short(sub.currentPeriodEnd)}
                </dd>
                {sub.trialEndsAt && sub.status === "trialing" && (
                  <>
                    <dt>Trial</dt>
                    <dd>
                      {untilDays(sub.trialEndsAt)} days left, ends {short(sub.trialEndsAt)}
                    </dd>
                  </>
                )}
                {sub.failedPayments > 0 && (
                  <>
                    <dt>Declines</dt>
                    <dd className="num">
                      {sub.failedPayments} of {TOTAL_ATTEMPTS}
                    </dd>
                  </>
                )}
                {sub.nextRetryAt && (
                  <>
                    <dt>Next try</dt>
                    <dd className="num">{stamp(sub.nextRetryAt)}</dd>
                  </>
                )}
                {sub.cancelAtPeriodEnd && (
                  <>
                    <dt>Ending</dt>
                    <dd>cancels {short(sub.currentPeriodEnd)}</dd>
                  </>
                )}
                {sub.canceledAt && (
                  <>
                    <dt>Canceled</dt>
                    <dd className="num">{stamp(sub.canceledAt)}</dd>
                  </>
                )}
                <dt>Collected</dt>
                <dd className="num">{fmt(collected)}</dd>
              </dl>
            </div>
          </div>

          <div className="panel">
            <header>
              <span className="label">Invoices</span>
              <span className="label">{sub.invoices.length} total</span>
            </header>
            <div className="scroll">
              {sub.invoices.length === 0 ? (
                <div className="empty">Nothing billed yet. Trials do not raise an invoice.</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Period</th>
                      <th className="r">Attempts</th>
                      <th className="r">Due</th>
                      <th className="r">Paid</th>
                      <th>State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sub.invoices.map((inv) => (
                      <tr key={inv.id}>
                        <td className="id">{inv.stripeInvoiceId}</td>
                        <td className="num">{short(inv.periodStart)}</td>
                        <td className="r num">{inv.attemptCount}</td>
                        <td className="r num">{fmt(inv.amountDue)}</td>
                        <td className="r num">{fmt(inv.amountPaid)}</td>
                        <td>
                          <span className={"pill " + (TONE[inv.status] ?? "")}>{inv.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="panel">
            <header>
              <span className="label">Charges</span>
              <span className="label">keyed by invoice and attempt</span>
            </header>
            <div className="scroll">
              {charges.length === 0 ? (
                <div className="empty">No charge attempts recorded.</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Idempotency key</th>
                      <th className="r">Amount</th>
                      <th>State</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {charges.map((c) => (
                      <tr key={c.id}>
                        <td className="id">{c.idempotencyKey}</td>
                        <td className="r num">{fmt(c.amount)}</td>
                        <td>
                          <span className={"pill " + (TONE[c.status] ?? "")}>{c.status}</span>
                        </td>
                        <td className="num">{stamp(c.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="panel">
            <header>
              <span className="label">State transitions</span>
              <Link href="/dashboard/events" className="label">
                webhook log →
              </Link>
            </header>
            <div className="body">
              <ul className="timeline">
                {sub.transitions.map((t) => (
                  <li key={t.id}>
                    <time>{stamp(t.at)}</time>
                    <span>
                      <span className="mono">{t.from}</span>
                      <span className="arrow">→</span>
                      <span className="mono">{t.to}</span>{" "}
                      <span className="muted">{t.reason}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <Manage
          subscriptionId={sub.id}
          plan={sub.plan}
          status={sub.status}
          simulated={!usingStripe}
        />
      </div>
    </main>
  );
}
