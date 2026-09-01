# Ledger

A subscription billing service built on Stripe. Checkout, trials, plan changes,
renewals, dunning, cancellation.

The checkout button is the easy half. The half that actually breaks in
production is everything downstream of it: Stripe redelivering the same webhook
four times, a payment event arriving before the subscription it belongs to, a
card that declines on the third renewal, someone upgrading eleven days into a
thirty day period. That is what most of this repo is about.

## Running it

You do not need a Stripe account.

```bash
npm install
cp .env.example .env
npm run db:push
npm run seed
npm run dev
```

With no `STRIPE_SECRET_KEY` set, a local simulator stands in for Stripe. It
builds Stripe shaped event objects, signs them with the webhook secret, and
posts them through the same endpoint a real delivery would hit. Signature
verification is done by the Stripe SDK either way, so that code path is not
mocked out.

The dashboard has a panel that drives the billing clock: end the trial, renew,
decline the card, retry. Those are the things Stripe's own scheduler would do
for you in live mode.

## Exactly once

Two separate guards, because they catch different failures.

The first is the webhook event id. It is the primary key of `WebhookEvent`, so
the second delivery of a retry storm loses the insert and is counted rather than
handled. Stripe redelivers on any non-2xx and gives no ordering guarantee, so
this happens constantly and is not an edge case.

That alone is not enough. Stripe can describe the same payment attempt through
more than one event, and those events have different ids. So the money layer has
its own key, `invoiceId:attemptCount`, on a unique index over `Charge`. A second
write for an attempt that already settled loses the insert and the handler stops
there without touching the state machine.

Each event is handled inside one transaction. That matters more than it looks:
an early version wrote the charge, then threw when it could not find the
subscription the payment belonged to, and the retry found its own charge row,
treated it as already applied, and skipped the state change. The subscription
sat in `trialing` with a paid invoice against it. Rolling the charge back with
the rest of the handler is what fixes that, and there is a test for it now.

A failed event is the one case that is allowed through the dedupe on redelivery,
since a retry after a 500 is exactly what you want to succeed.

## The state machine

Four states, `trialing`, `active`, `past_due`, `canceled`, and an explicit table
of legal moves in `src/lib/subscription/machine.ts`. Anything not in the table is
refused and logged rather than applied. A `payment_succeeded` that turns up after
a cancellation does not quietly revive the subscription, it gets written to the
transition log as a rejection with the reason attached.

Every move is appended to `Transition`, so you can read back why a subscription
ended up where it is. The dashboard renders that log directly.

## Proration

`prorate()` works on elapsed wall clock time in the period rather than on
calendar days, and truncates each leg to whole cents independently, which is what
Stripe does. Upgrading halfway through a month credits the unused half of the old
plan and charges half of the new one. Downgrades come out negative and carry to
the next invoice.

Plan changes are blocked while a subscription is `past_due`. Allowing one would
credit the customer for a period they never paid for.

## Dunning

One decline plus three retries at 24, 72 and 120 hours, then the subscription is
canceled. Retries reuse the open invoice and bump its attempt count the way
Stripe does, rather than raising a new invoice each time, which keeps the local
counter in step with theirs.

## Tests

```bash
npm test
```

34 tests against a separate SQLite file. The interesting ones:

`tests/replay.test.ts` runs 200 randomized retry storms. Each one takes a
subscription's events, duplicates each two to four times, adds a copy of the
payment carrying a fresh event id so the first dedupe layer cannot catch it,
shuffles the lot, delivers them in that order, then does a settling pass. Every
run has to end with the subscription active and exactly one charge for the
amount. It also covers signature verification: wrong secret, altered body,
stale timestamp, missing header.

`tests/state-machine.test.ts` covers twelve lifecycle edge cases, including the
ones that are easy to get wrong, like a late payment landing after cancellation
and a decline arriving during a trial.

`tests/proration.test.ts` covers the boundaries, including a change requested
outside the period, which clamps instead of going negative.

## Using real Stripe keys

Create three recurring prices in test mode and put them in `.env`:

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_GROWTH=price_...
STRIPE_PRICE_SCALE=price_...
```

Then forward events to the local endpoint:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

The simulator switches itself off as soon as a secret key is present. Checkout
sessions and subscription updates go to the real API, carrying the same
idempotency keys, and the six subscribed event types come back from Stripe
instead of from the simulator. Nothing in the webhook handlers changes.

## Layout

```
src/lib/subscription/machine.ts   states and legal transitions
src/lib/subscription/actions.ts   plan change and cancel
src/lib/webhook/ingest.ts         claim, dispatch, record
src/lib/webhook/handlers.ts       the six event handlers
src/lib/billing/proration.ts      mid period plan change maths
src/lib/billing/retry.ts          dunning schedule
src/lib/checkout.ts               session creation, live and simulated
src/lib/sim/                      the stand in for Stripe
```

Next.js, TypeScript, Prisma on SQLite, Vitest.
