"use client";

import {
  createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore,
  type FormEvent, type ReactNode
} from "react";

type InstallOutcome = "accepted" | "dismissed" | "unavailable";
type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
type PwaState = {
  isOffline: boolean;
  isStandalone: boolean;
  isInstalled: boolean;
  canInstall: boolean;
  needsHttps: boolean;
  install: () => Promise<InstallOutcome>;
};
const PwaContext = createContext<PwaState>({
  isOffline: false, isStandalone: false, isInstalled: false, canInstall: false,
  needsHttps: false, install: async () => "unavailable"
});
export const usePwa = () => useContext(PwaContext);

function subscribeConnection(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}
function subscribeDisplayMode(listener: () => void) {
  const media = window.matchMedia("(display-mode: standalone)");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
const onlineServerSnapshot = () => false;

export function PwaProvider({ children }: { children: ReactNode }) {
  const isOffline = useSyncExternalStore(subscribeConnection, () => !navigator.onLine, onlineServerSnapshot);
  const isStandalone = useSyncExternalStore(subscribeDisplayMode, () =>
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true, onlineServerSnapshot);
  const needsHttps = useSyncExternalStore(() => () => {}, () => !window.isSecureContext, onlineServerSnapshot);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [isInstalled, setInstalled] = useState(false);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const onInstalled = () => { setPrompt(null); setInstalled(true); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !window.isSecureContext || !("serviceWorker" in navigator)) return;
    const register = async () => {
      // A browser may block workers. Keep the online app usable and never send
      // registration failures to a league API or leave a rejected promise.
      try { await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }); }
      catch { /* Offline recovery is optional when browser settings block it. */ }
    };
    const onLoad = () => { void register(); };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
    return () => window.removeEventListener("load", onLoad);
  }, []);

  const install = useCallback(async (): Promise<InstallOutcome> => {
    if (!prompt || isOffline) return "unavailable";
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === "accepted") setInstalled(true);
      return outcome;
    } catch {
      return "unavailable";
    } finally { setPrompt(null); }
  }, [prompt, isOffline]);

  const preventOfflineSubmit = (event: FormEvent<HTMLDivElement>) => {
    if (isOffline || navigator.onLine === false) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return (
    <PwaContext.Provider value={{ isOffline, isStandalone, isInstalled, canInstall: !!prompt, needsHttps, install }}>
      <div className="app-viewport" onSubmitCapture={preventOfflineSubmit}>
        {isOffline ? (
          <aside className="connection-notice" role="status">
            <strong>You&apos;re offline.</strong> Reconnect before saving picks or making league changes.
            An open pick form can keep an unsent draft on this device. Nothing submits automatically.
          </aside>
        ) : null}
        {children}
      </div>
    </PwaContext.Provider>
  );
}
