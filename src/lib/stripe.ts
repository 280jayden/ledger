import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY ?? "";

export const usingStripe = key.startsWith("sk_");

// Constructed even with no key. Signature verification lives on this client and
// never touches the network, so the simulator signs with the same secret and
// runs through the exact verification path a real delivery would.
export const stripe = new Stripe(key || "sk_test_offline_simulator", {
  apiVersion: "2025-02-24.acacia",
  typescript: true,
});

export const WEBHOOK_SECRET =
  process.env.STRIPE_WEBHOOK_SECRET || "whsec_localsimulatorsecret";

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const HANDLED = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
] as const;

export type HandledType = (typeof HANDLED)[number];

export function isHandled(t: string): t is HandledType {
  return (HANDLED as readonly string[]).includes(t);
}
