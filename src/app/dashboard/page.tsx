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
        <h1>Nothing to show yet</h1>
        <p className="lede">
          Start a trial from the <Link href="/">plans page</Link> and this becomes the operator view
          for it: what state the subscription is in, every transition that got it there, the
          invoices behind those transitions, and the controls to change plan or cancel.
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
  const plan = PLANS[sub.plan];

  return (
    <main>
      <h1>Subscription</h1>
      <p className="lede" style={{ marginTop: 10 }}>
        {customer.email}
      </p>

      <div
        className="row"
        style={{ justifyContent: "space-between", marginTop: 26, gap: 20 }}
      >
        <div className="machine">
          {STAGES.map((s, i) => (
            <span key={s} style={{ display: "flex", alignItems: "center" }}>
              {i > 0 && <span className="link" />}
              <span className={"node" + (s === sub.status ? " on" : i < reached ? " done" : "")}>
                {s.replace("_", " ")}
              </span>
            </span>
          ))}
        </div>
        <span className="id">{sub.stripeSubscriptionId}</span>
      </div>

      <div className="cols" style={{ marginTop: 34 }}>
        <div>
          <dl className="kv">
            <dt>Plan</dt>
            <dd>
              {plan.name} <span className="muted">at {fmt(plan.price)} a month</span>
            </dd>
            <dt>Status</dt>
            <dd>
              <span className={"pill " + (TONE[sub.status] ?? "")}>{sub.status}</span>
            </dd>
            <dt>Period</dt>
            <dd className="num">
              {short(sub.currentPeriodStart)}
              <span className="arrow">to</span>
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
                <dd>cancels on {short(sub.currentPeriodEnd)}</dd>
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

          <div className="section">
            <div className="head">
              <h2>Invoices</h2>
              <span className="label">{sub.invoices.length} raised</span>
            </div>
            <div className="scroll">
              {sub.invoices.length === 0 ? (
                <p className="empty">Nothing billed yet. A trial does not raise an invoice.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Period from</th>
                      <th className="r">Tries</th>
                      <th className="r">Due</th>
                      <th className="r">Paid</th>
                      <th className="r">State</th>
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
                        <td className="r">
                          <span className={"pill " + (TONE[inv.status] ?? "")}>{inv.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="section">
            <div className="head">
              <h2>Charge attempts</h2>
              <span className="label">one row per invoice attempt</span>
            </div>
            <div className="scroll">
              {charges.length === 0 ? (
                <p className="empty">No charge has been attempted.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Idempotency key</th>
                      <th className="r">Amount</th>
                      <th className="r">State</th>
                      <th className="r">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {charges.map((c) => (
                      <tr key={c.id}>
                        <td className="id">{c.idempotencyKey}</td>
                        <td className="r num">{fmt(c.amount)}</td>
                        <td className="r">
                          <span className={"pill " + (TONE[c.status] ?? "")}>{c.status}</span>
                        </td>
                        <td className="r num">{stamp(c.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="section">
            <div className="head">
              <h2>How it got here</h2>
              <Link href="/dashboard/events" className="label">
                webhook log
              </Link>
            </div>
            <ul className="timeline">
              {sub.transitions.map((t) => (
                <li key={t.id}>
                  <time>{stamp(t.at)}</time>
                  <span>
                    <span className="mono">{t.from}</span>
                    <span className="arrow">to</span>
                    <span className="mono">{t.to}</span>{" "}
                    <span className="muted">{t.reason}</span>
                  </span>
                </li>
              ))}
            </ul>
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
