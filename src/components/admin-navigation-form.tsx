"use client";

import { useRouter } from "next/navigation";
import { useTransition, type FormEvent, type ReactNode } from "react";
import { usePwa } from "@/components/pwa-provider";

type Props = {
  children: ReactNode;
  className: string;
  fragment?: "audit-log";
  pendingLabel: string;
};

export function AdminNavigationForm({ children, className, fragment, pendingLabel }: Props) {
  const router = useRouter();
  const { isOffline } = usePwa();
  const [pending, startTransition] = useTransition();
  const hash = fragment ? "#" + fragment : "";

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || isOffline || navigator.onLine === false) return;

    const params = new URLSearchParams();
    for (const [name, value] of new FormData(event.currentTarget)) {
      if (typeof value === "string" && value.trim()) params.append(name, value.trim());
    }
    startTransition(() => router.push("/admin?" + params.toString() + hash, { scroll: false }));
  };

  return (
    <form action={"/admin" + hash} method="get" onSubmit={handleSubmit}>
      <fieldset className={className + " min-w-0"} disabled={pending || isOffline}>
        {children}
      </fieldset>
      <p className="text-sm text-slate-600" role="status">
        {pending ? pendingLabel : ""}
      </p>
    </form>
  );
}
