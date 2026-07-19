import { redirect } from "next/navigation";
import { requireAppUser } from "@/lib/authenticated-user";

export default async function HomePage() {
  await requireAppUser({ requireSeasonDecision: true });
  redirect("/dashboard");
}
