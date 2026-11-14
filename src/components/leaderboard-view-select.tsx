"use client";

import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { usePwa } from "@/components/pwa-provider";

type Props = {
  children: ReactNode;
  className: string;
  id: string;
  value: string;
} & ({ tab: "picks"; name: "race_id" } | { tab: "hall"; name: "year" });

export function LeaderboardViewSelect({ children, className, id, name, tab, value }: Props) {
  const router = useRouter();
  const { isOffline } = usePwa();
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <select
        className={className}
        disabled={isOffline || isPending}
        id={id}
        name={name}
        onChange={(event) => {
          const nextValue = event.currentTarget.value;
          if (isOffline || isPending || navigator.onLine === false || nextValue === value) return;

          const params = new URLSearchParams({ tab, [name]: nextValue });
          startTransition(() => router.push("/leaderboard?" + params.toString(), { scroll: false }));
        }}
        value={value}
      >
        {children}
      </select>
      <p className="text-xs text-slate-600" role="status">
        {isPending ? (tab === "picks" ? "Loading race…" : "Loading season…") : ""}
      </p>
    </>
  );
}
