"use client";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { usePwa } from "@/components/pwa-provider";
function vapidBytes(value: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)); }
async function api(path: string, method = "GET", value?: unknown) { const response = await fetch(path, { method, headers: value ? { "Content-Type": "application/json" } : {}, body: value ? JSON.stringify(value) : undefined, cache: "no-store" }); const data = await response.json(); if (!response.ok)
    throw new Error(data.error ?? "Notification settings are unavailable."); return data; }
class PushReadinessError extends Error {
    constructor(readonly needsReopen: boolean) {
        super(needsReopen
            ? "An app update is ready. Close Mound Hounds completely, then reopen it from your Home Screen."
            : "Notifications couldn’t get ready. Try again.");
    }
}
async function registration() {
    let registered: ServiceWorkerRegistration | undefined;
    const ready = navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then(reg => {
        registered = reg;
        return navigator.serviceWorker.ready;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reg: ServiceWorkerRegistration;
    try {
        reg = await Promise.race([
            ready,
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new PushReadinessError(!!registered?.waiting)), 10000); })
        ]);
    } finally {
        clearTimeout(timer);
    }
    const worker = reg.active;
    if (!worker) throw new PushReadinessError(!!reg.waiting);
    // Prepare before the permission gesture. An old worker may be waiting for an
    // update; do not reload open forms or activate another worker behind the user.
    const channel = new MessageChannel();
    try {
        await new Promise<void>((resolve, reject) => {
            timer = setTimeout(() => reject(new PushReadinessError(!!reg.waiting)), 8000);
            channel.port1.onmessage = event => {
                if (event.data?.push === true) resolve();
                else reject(new PushReadinessError(!!reg.waiting));
            };
            worker.postMessage({ type: "PUSH_CAPABILITY" }, [channel.port2]);
        });
    } finally {
        clearTimeout(timer);
        channel.port1.onmessage = null;
        channel.port1.close();
        channel.port2.close();
    }
    return reg;
}
export function PushNotificationSettings() {
    const { isStandalone, needsHttps } = usePwa();
    const supported = useSyncExternalStore(() => () => { }, () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window, () => false);
    const [key, setKey] = useState<string | null>(null);
    const [enabled, setEnabled] = useState(false);
    const [busy, setBusy] = useState(true);
    const [activity, setActivity] = useState("Checking notification settings…");
    const [prepareAttempt, setPrepareAttempt] = useState(0);
    const [preparation, setPreparation] = useState<{
        key: string; attempt: number; registration: ServiceWorkerRegistration | null; issue: PushReadinessError | null;
    } | null>(null);
    const currentPreparation = preparation && preparation.key === key && preparation.attempt === prepareAttempt ? preparation : null;
    const workerReady = !!currentPreparation?.registration;
    const readinessIssue = currentPreparation?.issue;
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
                setMessage("Notifications are blocked. Allow them in your device settings, then try again.");
            setKey(config.configured && typeof config.publicKey === "string" ? config.publicKey : null);
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
                setMessage("Couldn’t load notification settings. Check your connection and reopen this page.");
        }
        finally {
            if (active)
                setBusy(false);
        } })();
        return () => { active = false; };
    }, []);
    useEffect(() => {
        if (!key || !supported || !isStandalone || needsHttps) return;
        let active = true;
        registration().then(reg => {
            if (active) setPreparation({ key, attempt: prepareAttempt, registration: reg, issue: null });
        }).catch(error => {
            if (active) setPreparation({ key, attempt: prepareAttempt, registration: null,
                issue: error instanceof PushReadinessError ? error : new PushReadinessError(false) });
        });
        return () => { active = false; };
    }, [key, supported, isStandalone, needsHttps, prepareAttempt]);
    async function enable() {
        const reg = currentPreparation?.registration;
        if (!reg || !key) return;
        setBusy(true);
        setActivity("Enabling notifications…");
        setMessage("");
        let created: PushSubscription | null = null;
        try {
            // Keep the permission request directly in this tap. Readiness was
            // checked earlier, so allowing permission does not trigger an update check.
            const permission = Notification.permission === "default" ? Notification.requestPermission() : Promise.resolve(Notification.permission);
            const result = await permission;
            if (result !== "granted")
                throw new Error(result === "denied"
                    ? "Notifications are blocked. Allow them in your device settings, then try again."
                    : "Notifications are still off. You can enable them anytime.");
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
            setMessage("Notifications are on for this device.");
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
    async function disable() { setBusy(true); setActivity("Disabling notifications…"); try {
        const reg = await navigator.serviceWorker.getRegistration("/");
        const sub = await reg?.pushManager.getSubscription();
        if (sub) {
            await api("/api/push/subscription", "DELETE", { endpoint: sub.endpoint });
            setEnabled(false);
            await sub.unsubscribe();
        }
        setMessage("Notifications are off for this device.");
    }
    catch {
        setMessage("Could not finish disabling this device. Try again while online.");
    }
    finally {
        setBusy(false);
    } }
    async function test() { setBusy(true); setActivity("Sending test notification…"); try {
        const reg = await navigator.serviceWorker.getRegistration("/");
        const sub = await reg?.pushManager.getSubscription();
        if (!sub)
            throw new Error("Enable this device again first.");
        await api("/api/push/test", "POST", { endpoint: sub.endpoint });
        setMessage("Test sent. Check your notifications.");
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
    const guidance = needsHttps
        ? "Open Mound Hounds using its secure website link to set up notifications."
        : !isStandalone
            ? "Add Mound Hounds to your Home Screen, then open it to enable notifications."
            : !supported
                ? "This device doesn’t support notifications. On iPhone, use iOS 16.4 or later."
                : null;
    const setupPending = !busy && !key;
    const preparing = !!key && !guidance && !workerReady && !readinessIssue;
    const status = busy ? activity : preparing ? "Getting notifications ready…"
        : message || (!guidance && readinessIssue ? readinessIssue.message : "")
        || (setupPending || guidance ? "" : enabled ? "On for this device." : "Off for this device.");
    return (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="push-settings-heading">
            <h2 id="push-settings-heading" className="font-semibold">Device notifications</h2>
            <p className="mt-2 text-sm text-slate-600">Get pick reminders on this device.</p>
            {guidance ? (
                <p className="mt-3 text-sm">{guidance} {!isStandalone ? <Link href="/more/install" className="underline">How to install</Link> : null}</p>
            ) : setupPending ? (
                <p className="mt-3 text-sm">Device notifications aren’t available right now.</p>
            ) : !enabled && readinessIssue ? (
                !readinessIssue.needsReopen ? <button className="mt-4 min-h-11 rounded-md border px-4" onClick={() => { setMessage(""); setPrepareAttempt(attempt => attempt + 1); }}>Try again</button> : null
            ) : (
                <>
                    {!enabled ? <p className="mt-3 text-sm text-slate-600">Choose Allow when your device asks.</p> : null}
                    <div className="mt-4 flex flex-wrap gap-3">
                        {enabled ? <>
                            <button className="min-h-11 rounded-md border px-4" disabled={busy || (supported && Notification.permission === "denied")} onClick={test}>Send test notification</button>
                            <button className="min-h-11 rounded-md border px-4" disabled={busy} onClick={disable}>Disable notifications</button>
                        </> : <button className="min-h-11 rounded-md bg-slate-900 px-4 text-white disabled:opacity-50" disabled={busy || !key || !workerReady} onClick={enable}>Enable notifications</button>}
                    </div>
                </>
            )}
            {key && !delivery && !guidance ? <p className="mt-3 text-sm text-slate-600">Pick reminders haven’t started yet.</p> : null}
            <p className="mt-3 text-sm" role="status" aria-live="polite">{status}</p>
        </section>
    );
}
