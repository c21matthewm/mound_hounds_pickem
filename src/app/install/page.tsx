import type { Metadata } from "next";
import Link from "next/link";
import { AuthFlowShell } from "@/components/auth-flow-shell";
import { INSTALL_GUIDE_DESCRIPTION, InstallGuide } from "@/components/install-guide";

export const metadata: Metadata = { title: "Install the app | Mound Hounds Pick'em" };

export default function InstallPage() {
  return (
    <AuthFlowShell title="Install the app" description={INSTALL_GUIDE_DESCRIPTION} maxWidth="max-w-2xl"
      footer={<Link className="inline-flex min-h-11 items-center font-semibold text-blue-700 underline" href="/">Back to league</Link>}>
      <InstallGuide />
    </AuthFlowShell>
  );
}
