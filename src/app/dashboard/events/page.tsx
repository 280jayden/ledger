import { db } from "@/lib/db";
import { stamp } from "@/lib/dates";
import { HANDLED } from "@/lib/stripe";

export const dynamic = "force-dynamic";

const TONE: Record<string, string> = {
  processed: "ok",
  failed: "bad",
  ignored: "",
  processing: "warn",
};

export default async function Events() {
  const [totals, byStatus, events, chargeCount] = await Promise.all([
    db.webhookEvent.aggregate({ _sum: { deliveries: true }, _count: true }),
    db.webhookEvent.groupBy({ by: ["status"], _count: true }),
    db.webhookEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 60 }),
    db.charge.count(),
  ]);

  const unique = totals._count;
  const deliveries = totals._sum.deliveries ?? 0;
  const suppressed = deliveries - unique;
  const count = (s: string) => byStatus.find((r) => r.status === s)?._count ?? 0;

  return (
    <main>
      <h1>Webhook log</h1>
      <p className="lede">
        Every delivery that passed signature verification, in the order it arrived. Redeliveries do
        not get their own row — they increment the delivery count on the row that already exists.
      </p>

      <div className="panel" style={{ marginTop: 22 }}>
        <header>
          <span className="label">Dedupe</span>
          <span className="label">
            {HANDLED.length} subscribed types, {chargeCount} charge rows written
          </span>
        </header>
        <div className="body">
          <dl className="kv" style={{ gridTemplateColumns: "repeat(4, auto 1fr)" }}>
            <dt>Deliveries</dt>
            <dd className="num">{deliveries}</dd>
            <dt>Unique</dt>
            <dd className="num">{unique}</dd>
            <dt>Suppressed</dt>
            <dd className="num">{suppressed}</dd>
            <dt>Failed</dt>
            <dd className="num">{count("failed")}</dd>
          </dl>
          <p className="note">
            {suppressed > 0
              ? `${suppressed} repeat deliveries were dropped before reaching a handler.`
              : "No repeat deliveries yet. Replay one and the count moves without a second charge."}
          </p>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <header>
          <span className="label">Recent</span>
          <span className="label">
            {count("processed")} processed · {count("ignored")} ignored
          </span>
        </header>
        <div className="scroll">
          {events.length === 0 ? (
            <div className="empty">Nothing delivered yet.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Received</th>
                  <th>Type</th>
                  <th>Event</th>
                  <th className="r">Deliveries</th>
                  <th className="r">Attempts</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className="num">{stamp(e.receivedAt)}</td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {e.type}
                    </td>
                    <td className="id">{e.id}</td>
                    <td className="r num">{e.deliveries}</td>
                    <td className="r num">{e.attempts}</td>
                    <td>
                      <span className={"pill " + (TONE[e.status] ?? "")}>{e.status}</span>
                      {e.error && (
                        <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                          {e.error}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  );
}
