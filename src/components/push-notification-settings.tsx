"use client";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { usePwa } from "@/components/pwa-provider";
function vapidBytes(value: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)); }
async function api(path: string, method = "GET", value?: unknown) { const response = await fetch(path, { method, headers: value ? { "Content-Type": "application/json" } : {}, body: value ? JSON.stringify(value) : undefined, cache: "no-store" }); const data = await response.json(); if (!response.ok)
    throw new Error(data.error ?? "Notification settings are unavailable."); return data; }
async function registration() {
    await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("The app is updating. Reopen it and try again.")), 10000))]);
    // Never force an update while a race form may be open. Verify the active worker
    // supports push before subscribing an upgraded v1 Home Screen installation.
    if (!reg.active)
        throw new Error("Close all Mound Hounds windows and reopen the Home Screen app.");
    await new Promise<void>((resolve, reject) => { const channel = new MessageChannel(); const timer = setTimeout(() => { channel.port1.close(); reject(new Error("An app update is ready. Close all Mound Hounds windows and reopen before enabling notifications.")); }, 2000); channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); if (event.data?.push === true) resolve(); else reject(new Error("Reopen the app to finish its update.")); }; reg.active!.postMessage({ type: "PUSH_CAPABILITY" }, [channel.port2]); });
    return reg;
}
export function PushNotificationSettings({ isAdmin = false }: {
    isAdmin?: boolean;
}) {
    const { isStandalone, needsHttps } = usePwa();
    const supported = useSyncExternalStore(() => () => { }, () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window, () => false);
    const [key, setKey] = useState<string | null>(null);
    const [enabled, setEnabled] = useState(false);
    const [busy, setBusy] = useState(true);
    const [message, setMessage] = useState("");
    const [delivery, setDelivery] = useState(false);
    useEffect(() => {
        let active = true;
        const support = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
        (async () => { try {
            const config = await api("/api/push/subscription");
            if (!active)
                return;
            if (support && Notification.permission === "denied")
                setMessage("Notifications are blocked. Allow Mound Hounds in your device notification settings.");
            setKey(config.publicKey);
            setDelivery(config.pickDeliveryEnabled === true);
            if (config.setupRequired || !config.configured)
                setMessage("Device notifications are awaiting setup.");
            if (support) {
                const reg = await navigator.serviceWorker.getRegistration("/");
                const sub = await reg?.pushManager.getSubscription();
                if (sub) {
                    const status = await api("/api/push/subscription", "POST", { action: "status", endpoint: sub.endpoint });
                    if (active)
                        setEnabled(status.enabled === true);
                }
            }
        }
        catch {
            if (active)
                setMessage("Notification settings could not be loaded. Reopen this page to try again.");
        }
        finally {
            if (active)
                setBusy(false);
        } })();
        return () => { active = false; };
    }, []);
    async function enable() {
        // Request immediately within this gesture, before registration or network waits.
        const permission = Notification.permission === "default" ? Notification.requestPermission() : Promise.resolve(Notification.permission);
        setBusy(true);
        setMessage("");
        let created: PushSubscription | null = null;
        try {
            if (await permission !== "granted")
                throw new Error("Notifications are blocked. Allow Mound Hounds in iPhone Settings → Notifications or Android Site Settings, then try again.");
            if (!key)
                throw new Error("Notifications are awaiting setup.");
            const reg = await registration();
            let sub = await reg.pushManager.getSubscription();
            // A browser may retain a different account's device subscription after logout.
            if (sub) {
                const status = await api("/api/push/subscription", "POST", { action: "status", endpoint: sub.endpoint });
                if (!status.enabled) {
                    await sub.unsubscribe();
                    sub = null;
                }
            }
            if (!sub) {
                sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidBytes(key) });
                created = sub;
            }
            await api("/api/push/subscription", "POST", sub.toJSON());
            setEnabled(true);
            setMessage("Notifications enabled on this device.");
        }
        catch (error) {
            if (created)
                await created.unsubscribe().catch(() => { });
            setMessage(error instanceof Error ? error.message : "Could not enable notifications.");
        }
        finally {
            setBusy(false);
        }
    }
    async function disable() { setBusy(true); try {
        const reg = await navigator.serviceWorker.getRegistration("/");
        const sub = await reg?.pushManager.getSubscription();
        if (sub) {
            await api("/api/push/subscription", "DELETE", { endpoint: sub.endpoint });
            setEnabled(false);
            await sub.unsubscribe();
        }
        setMessage("Notifications disabled on this device.");
    }
    catch {
        setMessage("Could not finish disabling this device. Try again while online.");
    }
    finally {
        setBusy(false);
    } }
    async function test() { setBusy(true); try {
        const reg = await navigator.serviceWorker.getRegistration("/");
        const sub = await reg?.pushManager.getSubscription();
        if (!sub)
            throw new Error("Enable this device again first.");
        await api("/api/push/test", "POST", { endpoint: sub.endpoint });
        setMessage("Test sent. Check this device’s notifications.");
    }
    catch (error) {
        setMessage(error instanceof Error ? error.message : "Test could not be sent.");
        try {
            const reg = await navigator.serviceWorker.getRegistration("/");
            const sub = await reg?.pushManager.getSubscription();
            if (sub) {
                const status = await api("/api/push/subscription", "POST", { action: "status", endpoint: sub.endpoint });
                setEnabled(status.enabled === true);
            }
        }
        catch { /* Preserve the last known state while offline. */ }
    }
    finally {
        setBusy(false);
    } }
    const guidance = needsHttps ? "Notifications require a secure HTTPS connection (localhost is supported for development)." : !isStandalone ? "Install Mound Hounds and open it from its Home Screen icon to enable notifications on this device." : !supported ? "This device needs a browser with Web Push support. On iPhone, use iOS 16.4 or later and the Home Screen app." : null;
    const setupPending=!busy&&!key;
    return <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="push-settings-heading"><h2 id="push-settings-heading" className="font-semibold">Device notifications</h2><p className="mt-2 text-sm text-slate-600">Optional pick reminders for this device. Email reminder settings are separate and unchanged.{isAdmin ? " Enabling this device also allows staged-results alerts for administrators." : ""}</p>
 {guidance ? <p className="mt-3 text-sm">{guidance} {!isStandalone ? <Link href="/install" className="underline">Installation instructions</Link> : null}</p> : setupPending?<p className="mt-3 text-sm">Device notifications aren’t available yet. Email reminders continue separately.</p>:<div className="mt-4 flex flex-wrap gap-3">{enabled ? <><button className="min-h-11 rounded-md border px-4" disabled={busy || (supported && Notification.permission === "denied")} onClick={test}>Send test notification</button><button className="min-h-11 rounded-md border px-4" disabled={busy} onClick={disable}>Disable on this device</button></> : <button className="min-h-11 rounded-md bg-slate-900 px-4 text-white disabled:opacity-50" disabled={busy || !key} onClick={enable}>Enable notifications on this device</button>}</div>}
 {key&&!delivery ? <p className="mt-3 text-sm text-slate-600">Scheduled pick reminders are not enabled yet. You can still set up this device and send a test.</p> : null}
 <p className="mt-3 text-sm" role="status" aria-live="polite">{busy ? "Checking device settings…" : setupPending?"":message || (enabled ? "Enabled on this device." : "Off on this device.")}</p></section>;
}
