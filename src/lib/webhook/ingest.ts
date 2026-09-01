import type Stripe from "stripe";
import { db } from "@/lib/db";
import { isHandled } from "@/lib/stripe";
import { isUniqueViolation } from "./dedupe";
import { handle } from "./handlers";

export type IngestResult =
  | { status: "processed"; id: string }
  | { status: "duplicate"; id: string; deliveries: number }
  | { status: "ignored"; id: string }
  | { status: "failed"; id: string; error: string };

export async function ingest(event: Stripe.Event, raw: string): Promise<IngestResult> {
  if (!isHandled(event.type)) {
    await db.webhookEvent
      .create({ data: { id: event.id, type: event.type, status: "ignored", payload: raw } })
      .catch((e) => {
        if (!isUniqueViolation(e)) throw e;
      });
    return { status: "ignored", id: event.id };
  }

  const claim = await claimEvent(event, raw);
  if (claim.duplicate) {
    return { status: "duplicate", id: event.id, deliveries: claim.deliveries };
  }

  try {
    await handle(event);
    await db.webhookEvent.update({
      where: { id: event.id },
      data: { status: "processed", processedAt: new Date(), error: null },
    });
    return { status: "processed", id: event.id };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.webhookEvent.update({ where: { id: event.id }, data: { status: "failed", error } });
    return { status: "failed", id: event.id, error };
  }
}

type Claim = { duplicate: false } | { duplicate: true; deliveries: number };

// The claim is the dedupe. Stripe's event id is our primary key, so the second
// delivery of a retry storm loses the insert and never reaches a handler. The
// one case we do let through again is a previous attempt that ended in failed,
// because that is exactly what Stripe is retrying for.
async function claimEvent(event: Stripe.Event, raw: string): Promise<Claim> {
  try {
    await db.webhookEvent.create({
      data: { id: event.id, type: event.type, status: "processing", payload: raw, attempts: 1 },
    });
    return { duplicate: false };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
  }

  const prior = await db.webhookEvent.update({
    where: { id: event.id },
    data: { deliveries: { increment: 1 } },
  });

  if (prior.status !== "failed") return { duplicate: true, deliveries: prior.deliveries };

  await db.webhookEvent.update({
    where: { id: event.id },
    data: { status: "processing", attempts: { increment: 1 }, error: null },
  });
  return { duplicate: false };
}
