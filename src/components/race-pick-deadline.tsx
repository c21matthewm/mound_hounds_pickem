"use client";

import { useEffect, useState } from "react";
import { raceDeadlineLabel } from "@/lib/race-deadline";

type Props = { deadline: string; initialTime: number };

export function RacePickDeadline({ deadline, initialTime }: Props) {
  const [now, setNow] = useState(initialTime);
  useEffect(() => {
    // Update the label locally; never reload Admin or poll application services.
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 15_000);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, []);
  return <span className="font-semibold text-slate-800">{raceDeadlineLabel(deadline, now)}</span>;
}
