import { Prisma } from "@prisma/client";

export function isUniqueViolation(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

// One key per logical payment attempt, not per event id. Stripe can describe
// the same attempt through more than one event, and a replayed event keeps its
// id, so keying on invoice+attempt is what actually makes the charge write
// exactly-once in both directions.
export function chargeKey(invoiceId: string, attempt: number) {
  return `${invoiceId}:${attempt}`;
}
