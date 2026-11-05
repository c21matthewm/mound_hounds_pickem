"use client";

import { useState } from "react";
import { usePwa } from "@/components/pwa-provider";
import { actionControlClassName, CompactNotice } from "@/components/ui-primitives";

export function InstallAppControls() {
  const { canInstall, isInstalled, isStandalone, isOffline, needsHttps, install } = usePwa();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  if (isStandalone) return <CompactNotice tone="success">You&apos;re using the Home Screen app.</CompactNotice>;
  if (isInstalled) return <CompactNotice tone="success">App added. Open Mound Hounds from your Home Screen or app launcher.</CompactNotice>;
  if (needsHttps) return <CompactNotice tone="warning">Installation and offline support need a secure HTTPS connection. This local preview can still be used to check the layout.</CompactNotice>;
  return (
    <div className="space-y-3">
      {canInstall ? (
        <button className={actionControlClassName("primary", "min-h-11")} disabled={pending || isOffline} onClick={async () => {
          setPending(true);
          const result = await install();
          setPending(false);
          if (result !== "accepted") setMessage(result === "dismissed"
            ? "You can add the app later from your browser menu."
            : "Use the browser steps below to add the app.");
        }} type="button">{pending ? "Opening install options..." : "Install Mound Hounds"}</button>
      ) : <p className="text-sm leading-6 text-slate-600">Use your browser&apos;s Home Screen option below. Installation options vary by device.</p>}
      {message ? <p aria-live="polite" className="text-sm text-slate-600">{message}</p> : null}
    </div>
  );
}
