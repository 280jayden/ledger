import type { Metadata } from "next";
import Link from "next/link";
import { Instrument_Serif, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { usingStripe } from "@/lib/stripe";
import "./globals.css";

const display = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--f-display",
  display: "swap",
});

const sans = IBM_Plex_Sans({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--f-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--f-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ledger",
  description: "Stripe subscriptions with the webhook plumbing done properly.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <header className="masthead">
          <div className="inner">
            <Link href="/" className="wordmark">
              Ledger
            </Link>
            <span className="mode">{usingStripe ? "test mode" : "simulator"}</span>
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
