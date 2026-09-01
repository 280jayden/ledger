import Link from "next/link";
import { db } from "@/lib/db";
import { TRIAL_DAYS } from "@/lib/plans";

export const dynamic = "force-dynamic";

export default async function Done({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const { session } = await searchParams;
  const record = session
    ? await db.idempotencyRecord.findFirst({ where: { result: session } })
    : null;

  return (
    <main>
      <h1>Trial started</h1>
      <p className="lede">
        {TRIAL_DAYS} days, nothing charged. The checkout and subscription events have already been
        delivered and applied.
      </p>

      <div className="section" style={{ maxWidth: 560 }}>
        <div className="head">
          <h2>Checkout session</h2>
        </div>
        <dl className="kv" style={{ marginTop: 16 }}>
          <dt>Session</dt>
          <dd className="id">{session ?? "unknown"}</dd>
          <dt>Key</dt>
          <dd className="id">{record?.key ?? "not recorded"}</dd>
        </dl>
        <p className="note">
          Reloading this page creates nothing. That key is spent, and any request carrying it again
          gets this same session back.
        </p>
      </div>

      <p style={{ marginTop: 30 }}>
        <Link href="/dashboard" className="btn primary">
          Open the subscription
        </Link>
      </p>
    </main>
  );
}
