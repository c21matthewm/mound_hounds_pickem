import type { Metadata } from "next";
import Link from "next/link";
import { AuthFlowShell, AuthFormPanel } from "@/components/auth-flow-shell";
import { InstallAppControls } from "@/components/install-app-controls";

export const metadata: Metadata = { title: "Install the app | Mound Hounds Pick'em" };

export default function InstallPage() {
  return (
    <AuthFlowShell title="Install the app" description="Add Mound Hounds to your Home Screen for quick access to picks and standings." maxWidth="max-w-2xl"
      footer={<Link className="inline-flex min-h-11 items-center font-semibold text-blue-700 underline" href="/">Back to league</Link>}>
      <AuthFormPanel><InstallAppControls /></AuthFormPanel>
      <section aria-labelledby="iphone-install" className="mt-6">
        <h2 className="text-lg font-semibold text-slate-950" id="iphone-install">iPhone and iPad</h2>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600">
          <li>Open this site in Safari and tap Share.</li>
          <li>Choose <strong>Add to Home Screen</strong>. Leave <strong>Open as Web App</strong> enabled if it is shown, then tap Add.</li>
          <li>Open the Mound Hounds icon from your Home Screen. Sign in if prompted.</li>
        </ol>
      </section>
      <section aria-labelledby="android-install" className="mt-6">
        <h2 className="text-lg font-semibold text-slate-950" id="android-install">Android</h2>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600">
          <li>Open this site in Chrome.</li>
          <li>Tap Install above when offered, or open the browser menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
          <li>Confirm, then open Mound Hounds from your Home Screen or app launcher.</li>
        </ol>
      </section>
      <section aria-labelledby="device-reminders" className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 id="device-reminders" className="text-lg font-semibold text-slate-950">Optional notifications</h2>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600">
          <li>Open the Home Screen app and sign in.</li>
          <li>Open <Link href="/profile" className="font-semibold underline">Profile</Link> and choose <strong>Enable notifications</strong>, then tap <strong>Allow</strong>.</li>
          <li>Tap <strong>Send test notification</strong> to check it worked.</li>
        </ol>
        <p className="mt-3 text-sm text-slate-600">You can turn off device notifications in Profile with <strong>Disable notifications</strong>.</p>
      </section>
      <section aria-labelledby="offline-support" className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
        <h2 className="text-lg font-semibold text-slate-950" id="offline-support">What works offline?</h2>
        <p className="mt-2 text-sm leading-6 text-slate-700">After an online visit, the app can show a recovery screen when you lose your connection. An already-open pick form can keep its unsent draft on this device where browser storage is available.</p>
        <p className="mt-2 text-sm leading-6 text-slate-700">Loading league pages, standings, rules, sign-in, saving picks, and Admin changes require internet. Reconnect and save drafts manually before the deadline. Nothing queues or submits in the background.</p>
        <p className="mt-2 text-sm leading-6 text-slate-700">Only the recovery screen and its icon are kept for offline use. League data is not saved for offline browsing.</p>
      </section>
    </AuthFlowShell>
  );
}
