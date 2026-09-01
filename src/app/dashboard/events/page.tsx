import { db } from "@/lib/db";
import { stamp } from "@/lib/dates";
import { HANDLED } from "@/lib/stripe";
import Replay from "@/components/Replay";

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
        Every delivery that got past signature verification, newest first. A redelivery does not get
        its own row. It bumps the count on the row that is already there.
      </p>

      <div className="section">
        <div className="head">
          <h2>Dedupe</h2>
          <span className="label">
            {HANDLED.length} subscribed types, {chargeCount} charge rows written
          </span>
        </div>
        <dl className="kv" style={{ gridTemplateColumns: "repeat(4, auto minmax(0, 1fr))", marginTop: 16 }}>
          <dt>Deliveries</dt>
          <dd className="num">{deliveries}</dd>
          <dt>Unique</dt>
          <dd className="num">{unique}</dd>
          <dt>Dropped</dt>
          <dd className="num">{suppressed}</dd>
          <dt>Failed</dt>
          <dd className="num">{count("failed")}</dd>
        </dl>
        <p className="note">
          {suppressed > 0
            ? `${suppressed} repeat deliveries were dropped before they reached a handler.`
            : "Nothing has been redelivered yet. Replay a row below and watch the delivery count move without a second charge appearing."}
        </p>
      </div>

      <div className="section">
        <div className="head">
          <h2>Recent</h2>
          <span className="label">
            {count("processed")} processed, {count("ignored")} ignored
          </span>
        </div>
        <div className="scroll">
          {events.length === 0 ? (
            <p className="empty">Nothing has been delivered yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Received</th>
                  <th>Type</th>
                  <th>Event</th>
                  <th className="r">Deliveries</th>
                  <th className="r">Tries</th>
                  <th className="r">State</th>
                  <th className="r"></th>
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
                    <td className="r">
                      <span className={"pill " + (TONE[e.status] ?? "")}>{e.status}</span>
                      {e.error && (
                        <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                          {e.error}
                        </div>
                      )}
                    </td>
                    <td className="r">
                      <Replay id={e.id} />
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
