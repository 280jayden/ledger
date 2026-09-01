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
        {TRIAL_DAYS} days, no charge yet. Stripe has already sent the checkout and subscription
        events, and both have been applied.
      </p>

      <div className="panel" style={{ marginTop: 22, maxWidth: 560 }}>
        <header>
          <span className="label">Checkout session</span>
        </header>
        <div className="body">
          <dl className="kv">
            <dt>Session</dt>
            <dd className="id">{session ?? "unknown"}</dd>
            <dt>Key</dt>
            <dd className="id">{record?.key ?? "not recorded"}</dd>
          </dl>
          <p className="note">
            Reloading this page will not create anything. The key above is spent, and a second
            request carrying it gets this same session back.
          </p>
        </div>
      </div>

      <p style={{ marginTop: 24 }}>
        <Link href="/dashboard" className="btn primary">
          Open the subscription
        </Link>
      </p>
    </main>
  );
}
