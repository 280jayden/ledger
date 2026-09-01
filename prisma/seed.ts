import { db } from "@/lib/db";
import { createCheckout } from "@/lib/checkout";
import { advanceCycle, endTrial, retryOpenInvoice } from "@/lib/sim/gateway";
import { receive, sign } from "@/lib/webhook/receive";
import type { PlanId } from "@/lib/plans";

async function subFor(email: string) {
  const customer = await db.customer.findUniqueOrThrow({
    where: { email },
    include: { subscriptions: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  return customer.subscriptions[0];
}

async function trial(email: string, plan: PlanId) {
  const r = await createCheckout({ email, plan, idempotencyKey: `seed:${email}` });
  if (!r.ok) throw new Error(`${email}: ${r.error}`);
  return subFor(email);
}

// Redeliver whatever we already stored for this subscription, a few times over.
// Leaves the log with something to look at on a fresh clone.
async function replayAll(times: number) {
  const events = await db.webhookEvent.findMany({ take: 4, orderBy: { receivedAt: "desc" } });
  for (const e of events) {
    for (let i = 0; i < times; i++) await receive(e.payload, sign(e.payload));
  }
}

async function main() {
  const existing = await db.customer.count();
  if (existing > 0) {
    console.log(`${existing} customers already here, leaving the database alone`);
    return;
  }

  const paying = await trial("rosa@northgate.co", "growth");
  await endTrial(paying.id, "paid");

  const struggling = await trial("dev@parcelworks.io", "starter");
  await endTrial(struggling.id, "paid");
  await advanceCycle(struggling.id, "declined");
  await retryOpenInvoice(struggling.id, "declined");

  const churned = await trial("ops@halcyon.systems", "scale");
  await endTrial(churned.id, "paid");
  await advanceCycle(churned.id, "declined");
  for (let i = 0; i < 3; i++) await retryOpenInvoice(churned.id, "declined");

  await trial("new@tidebreak.app", "growth");

  await replayAll(2);

  const subs = await db.subscription.findMany({ select: { plan: true, status: true } });
  const charges = await db.charge.count({ where: { status: "succeeded" } });
  const events = await db.webhookEvent.aggregate({ _sum: { deliveries: true }, _count: true });

  console.log(subs.map((s) => `${s.plan}: ${s.status}`).join("\n"));
  console.log(
    `${events._count} events, ${events._sum.deliveries} deliveries, ${charges} charges written`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
