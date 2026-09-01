"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Replay({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    const res = await fetch(`/api/events/${id}/replay`, { method: "POST" });
    const data = await res.json();
    setOutcome(data.status ?? "error");
    setBusy(false);
    router.refresh();
  }

  return (
    <span className="row" style={{ gap: 7, justifyContent: "flex-end" }}>
      {outcome && <span className="label">{outcome}</span>}
      <button onClick={go} disabled={busy} style={{ fontSize: 11.5, padding: "3px 8px 4px" }}>
        Replay
      </button>
    </span>
  );
}
