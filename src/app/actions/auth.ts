"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { sanitizeNextPath } from "@/lib/query";
import { loadActiveLeagueSeason } from "@/lib/seasons";
import { invalidateScoringCache } from "@/lib/scoring-cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";

const MAX_NAME_LENGTH = 100;
const MIN_PASSWORD_LENGTH = 10;

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

  if (fullName.length > MAX_NAME_LENGTH || teamName.length > MAX_NAME_LENGTH) {
    errorRedirect("/signup", "Names must be 100 characters or fewer.");
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    errorRedirect("/signup", `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  if (password !== confirmPassword) {
    errorRedirect("/signup", "Password confirmation does not match.");
  }

  const registrationSeason = await loadActiveLeagueSeason(createServiceRoleSupabaseClient());
  if (!registrationSeason) {
    errorRedirect("/signup", "Registration is not open because no league season is active.");
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

export async function requestPasswordResetAction(formData: FormData) {
  const email = asText(formData.get("email")).toLowerCase();

  if (!email) {
    errorRedirect("/forgot-password", "Email is required.");
  }

  const supabase = await createServerSupabaseClient();
  const origin = await getOrigin();

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`
  });

  if (error) {
    console.error("[auth] resetPasswordForEmail failed:", error.message);
    errorRedirect("/forgot-password", friendlyAuthError(error.message));
  }

  messageRedirect(
    "/forgot-password",
    "If that email is tied to an account, a password reset link has been sent."
  );
}

export async function updatePasswordAction(formData: FormData) {
  const password = asText(formData.get("password"));
  const confirmPassword = asText(formData.get("confirm_password"));

  if (!password || !confirmPassword) {
    errorRedirect("/reset-password", "Password and confirmation are required.");
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    errorRedirect(
      "/reset-password",
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    );
  }

  if (password !== confirmPassword) {
    errorRedirect("/reset-password", "Password confirmation does not match.");
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser();

  if (authError || !user) {
    errorRedirect("/login", "Your password reset link expired. Request a new reset link.");
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    console.error("[auth] updateUser password failed:", error.message);
    errorRedirect("/reset-password", friendlyAuthError(error.message));
  }

  await supabase.auth.signOut();
  messageRedirect("/login", "Password updated. Sign in with your new password.");
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

  if (!fullName || !teamName) {
    errorRedirect("/onboarding", "Your name and team name are required.");
  }

  if (fullName.length > MAX_NAME_LENGTH || teamName.length > MAX_NAME_LENGTH) {
    errorRedirect("/onboarding", "Names must be 100 characters or fewer.");
  }

  if (phoneNumber && digitsOnly.length < 10) {
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
      phone_carrier: phoneCarrier || null,
      phone_number: phoneNumber || null,
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

  const { error: registrationError } = await supabase.rpc("set_active_season_participation", {
    p_register: true
  });

  if (registrationError) {
    errorRedirect("/season-registration", registrationError.message);
  }

  invalidateScoringCache();
  messageRedirect("/dashboard", "Profile saved and season registration confirmed.");
}

export async function setSeasonParticipationAction(formData: FormData) {
  const decision = asText(formData.get("decision"));
  const next = sanitizeNextPath(asText(formData.get("next")) || "/dashboard");

  if (decision !== "register" && decision !== "decline") {
    errorRedirect("/season-registration", "Choose whether you are joining this season.");
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    errorRedirect("/login", "Your session expired. Please sign in again.");
  }

  const { error } = await supabase.rpc("set_active_season_participation", {
    p_register: decision === "register"
  });

  if (error) {
    errorRedirect("/season-registration", error.message);
  }

  invalidateScoringCache();
  const message =
    decision === "register"
      ? "Season registration confirmed."
      : "You will not appear in this season's field. You can change this decision before making picks.";
  messageRedirect(next, message);
}
