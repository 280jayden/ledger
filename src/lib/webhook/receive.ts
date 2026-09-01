import type Stripe from "stripe";
import { stripe, WEBHOOK_SECRET } from "@/lib/stripe";
import { ingest, type IngestResult } from "./ingest";

export type ReceiveResult = IngestResult | { status: "invalid_signature"; error: string };

export async function receive(raw: string, signature: string | null): Promise<ReceiveResult> {
  if (!signature) return { status: "invalid_signature", error: "missing stripe-signature header" };

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, WEBHOOK_SECRET);
  } catch (e) {
    return { status: "invalid_signature", error: e instanceof Error ? e.message : "bad signature" };
  }

  return ingest(event, raw);
}

export function sign(payload: string, at = Math.floor(Date.now() / 1000)) {
  return stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
    timestamp: at,
  });
}
