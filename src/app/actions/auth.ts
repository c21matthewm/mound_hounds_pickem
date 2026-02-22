"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { sanitizeNextPath } from "@/lib/query";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const errorRedirect = (path: string, message: string): never => {
  const params = new URLSearchParams({ error: message });
  redirect(`${path}?${params.toString()}`);
};

const messageRedirect = (path: string, message: string): never => {
  const params = new URLSearchParams({ message });
  redirect(`${path}?${params.toString()}`);
};

const asText = (value: FormDataEntryValue | null): string =>
  typeof value === "string" ? value.trim() : "";

const friendlyAuthError = (message: string): string => {
  const normalized = message.toLowerCase();

  if (normalized.includes("email not confirmed")) {
    return "Your email is not confirmed yet. Check your inbox/spam for the confirmation link, then sign in again.";
  }

  return message;
};

const getOrigin = async (): Promise<string> => {
  const requestHeaders = await headers();
  const explicitOrigin = requestHeaders.get("origin");
  if (explicitOrigin) {
    return explicitOrigin;
  }

  const forwardedHost = requestHeaders.get("x-forwarded-host");
  const host = requestHeaders.get("host");
  const resolvedHost = forwardedHost ?? host;
  if (resolvedHost) {
    const forwardedProto = requestHeaders.get("x-forwarded-proto");
    const proto = forwardedProto ?? (resolvedHost.includes("localhost") ? "http" : "https");
    return `${proto}://${resolvedHost}`;
  }

  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
};

export async function signInAction(formData: FormData) {
  const email = asText(formData.get("email")).toLowerCase();
  const password = asText(formData.get("password"));
  const next = sanitizeNextPath(asText(formData.get("next")));

  if (!email || !password) {
    errorRedirect("/login", "Email and password are required.");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    console.error("[auth] signInWithPassword failed:", error.message);
    errorRedirect("/login", friendlyAuthError(error.message));
  }

  redirect(next);
}

export async function signUpAction(formData: FormData) {
  const fullName = asText(formData.get("full_name"));
  const teamName = asText(formData.get("team_name"));
  const email = asText(formData.get("email")).toLowerCase();
  const password = asText(formData.get("password"));
  const confirmPassword = asText(formData.get("confirm_password"));

  if (!fullName || !teamName || !email || !password || !confirmPassword) {
    errorRedirect("/signup", "All fields are required.");
  }

  if (password.length < 6) {
    errorRedirect("/signup", "Password must be at least 6 characters.");
  }

  if (password !== confirmPassword) {
    errorRedirect("/signup", "Password confirmation does not match.");
  }

  const supabase = await createServerSupabaseClient();
  const origin = await getOrigin();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        team_name: teamName
      },
      emailRedirectTo: `${origin}/auth/callback?next=/onboarding`
    }
  });

  if (error) {
    console.error("[auth] signUp failed:", error.message);
    errorRedirect("/signup", friendlyAuthError(error.message));
  }

  if (data.session) {
    messageRedirect("/onboarding", "Account created. Complete your profile to continue.");
  }

  messageRedirect("/login", "Check your email to confirm your account.");
}

export async function signOutAction() {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function saveProfileAction(formData: FormData) {
  const fullName = asText(formData.get("full_name"));
  const teamName = asText(formData.get("team_name"));
  const phoneNumber = asText(formData.get("phone_number"));
  const phoneCarrier = asText(formData.get("phone_carrier"));
  const digitsOnly = phoneNumber.replace(/\D/g, "");

  if (!fullName || !teamName || !phoneNumber || !phoneCarrier) {
    errorRedirect("/onboarding", "All onboarding fields are required.");
  }

  if (digitsOnly.length < 10) {
    errorRedirect("/onboarding", "Phone number must include at least 10 digits.");
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser();
  const userId = user?.id;

  if (authError || !userId) {
    errorRedirect("/login", "Your session expired. Please sign in again.");
  }

  const { error } = await supabase.from("profiles").upsert(
    {
      full_name: fullName,
      id: userId,
      phone_carrier: phoneCarrier,
      phone_number: phoneNumber,
      team_name: teamName
    },
    { onConflict: "id" }
  );

  if (error) {
    if (error.code === "23505") {
      errorRedirect("/onboarding", "Team name is already taken. Choose a different name.");
    }

    errorRedirect("/onboarding", error.message);
  }

  messageRedirect("/dashboard", "Profile saved.");
}
