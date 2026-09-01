import { receive } from "@/lib/webhook/receive";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const raw = await req.text();
  const result = await receive(raw, req.headers.get("stripe-signature"));

  if (result.status === "invalid_signature") {
    return Response.json(result, { status: 400 });
  }

  // Duplicates and ignored types are a 200 so Stripe stops redelivering them.
  // A handler that actually threw gets a 500, because that one we do want back.
  return Response.json(result, { status: result.status === "failed" ? 500 : 200 });
}
