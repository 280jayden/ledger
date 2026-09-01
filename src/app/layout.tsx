import type { Metadata } from "next";
import Link from "next/link";
import { usingStripe } from "@/lib/stripe";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ledger",
  description: "Subscription billing on Stripe, with the webhook plumbing done properly.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="masthead">
          <div className="inner">
            <Link href="/" className="wordmark">
              Ledger<span>.</span>
            </Link>
            <span className="mode">{usingStripe ? "stripe test mode" : "simulator"}</span>
            <nav>
              <Link href="/">Plans</Link>
              <Link href="/dashboard">Subscription</Link>
              <Link href="/dashboard/events">Events</Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
