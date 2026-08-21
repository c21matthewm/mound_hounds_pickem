"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { sanitizeNextPath } from "@/lib/query";
import { loadActiveLeagueSeason } from "@/lib/seasons";
import { invalidateScoringCache } from "@/lib/scoring-cache";
import { consumeRegistrationAttempt } from "@/lib/registration-rate-limit";
import { errorReference, reportAppError } from "@/lib/app-error-reporter";
import { participantSafeErrorMessage } from "@/lib/app-error-safety";
import { resolveAuthOrigin } from "@/lib/site-url";
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

  if (normalized.includes("invalid login credentials")) {
    return "Email or password is incorrect.";
  }

  if (normalized.includes("user already registered")) {
    return "An account already exists for this email. Sign in or reset your password.";
  }

  if (normalized.includes("password") && normalized.includes("weak")) {
    return "Choose a stronger password and try again.";
  }

  return "Authentication could not be completed. Please try again.";
};

const isExpectedAuthError = (message: string): boolean =>
  /email not confirmed|invalid login credentials|user already registered|weak password|password.*weak|rate limit|too many requests/i.test(
    message
  );

const getOrigin = async (): Promise<string> => {
  const requestHeaders = await headers();
  return resolveAuthOrigin({ requestOrigin: requestHeaders.get("origin") });
};

export async function signInAction(formData: FormData) {
  const email = asText(formData.get("email")).toLowerCase();
  const password = asText(formData.get("password"));
  const next = sanitizeNextPath(asText(formData.get("next")) || "/dashboard");

  if (!email || !password) {
    errorRedirect("/login", "Email and password are required.");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    console.error("[auth] signInWithPassword failed:", error.message);
    const reported = isExpectedAuthError(error.message)
      ? null
      : await reportAppError({
          code: "sign-in-failed",
          context: { operation: "sign_in" },
          error,
          route: "/login",
          subsystem: "auth"
        });
    errorRedirect(
      "/login",
      `${friendlyAuthError(error.message)}${reported ? errorReference(reported) : ""}`
    );
  }

  redirect(next);
}

export async function signUpAction(formData: FormData) {
  const fullName = asText(formData.get("full_name"));
  const teamName = asText(formData.get("team_name"));
  const email = asText(formData.get("email")).toLowerCase();
  const password = asText(formData.get("password"));
  const confirmPassword = asText(formData.get("confirm_password"));
  const inviteCode = asText(formData.get("invite_code"));

  if (!fullName || !teamName || !email || !password || !confirmPassword || !inviteCode) {
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

  let registrationSeason: Awaited<ReturnType<typeof loadActiveLeagueSeason>> = null;
  try {
    registrationSeason = await loadActiveLeagueSeason(createServiceRoleSupabaseClient());
  } catch (seasonError) {
    const reported = await reportAppError({
      code: "load-signup-season-failed",
      context: { operation: "signup" },
      error: seasonError,
      route: "/signup",
      subsystem: "auth"
    });
    errorRedirect(
      "/signup",
      `Registration could not be opened. Please try again.${errorReference(reported)}`
    );
  }
  if (!registrationSeason) {
    errorRedirect("/signup", "Registration is not open because no league season is active.");
  }
  const selectedRegistrationSeason = registrationSeason!;
  if (!selectedRegistrationSeason.registrationCodeConfiguredAt) {
    errorRedirect(
      "/signup",
      "Registration is not open yet because the season invite code has not been configured."
    );
  }

  const serviceSupabase = createServiceRoleSupabaseClient();
  let registrationAttemptAllowed = false;
  try {
    registrationAttemptAllowed = await consumeRegistrationAttempt({
      email,
      supabase: serviceSupabase
    });
  } catch (rateLimitError) {
    console.error(
      "[auth] registration rate limit failed:",
      rateLimitError instanceof Error ? rateLimitError.message : rateLimitError
    );
    const reported = await reportAppError({
      code: "registration-rate-limit-failed",
      context: { operation: "signup" },
      error: rateLimitError,
      route: "/signup",
      subsystem: "auth"
    });
    errorRedirect(
      "/signup",
      `Registration could not be verified. Please try again shortly.${errorReference(reported)}`
    );
  }
  if (!registrationAttemptAllowed) {
    errorRedirect("/signup", "Too many registration attempts. Wait 15 minutes and try again.");
  }

  const { data: inviteCodeValid, error: inviteCodeError } = await serviceSupabase.rpc(
    "validate_season_invite_code",
    {
      p_invite_code: inviteCode,
      p_season_id: selectedRegistrationSeason.id
    }
  );
  if (inviteCodeError) {
    console.error("[auth] invite code validation failed:", inviteCodeError.message);
    const reported = await reportAppError({
      code: "invite-code-validation-failed",
      context: { operation: "signup" },
      error: inviteCodeError,
      route: "/signup",
      subsystem: "auth"
    });
    errorRedirect(
      "/signup",
      `Registration could not be verified. Please try again.${errorReference(reported)}`
    );
  }
  if (!inviteCodeValid) {
    errorRedirect("/signup", "The season invite code is incorrect.");
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
    const reported = isExpectedAuthError(error.message)
      ? null
      : await reportAppError({
          code: "sign-up-failed",
          context: { operation: "sign_up" },
          error,
          route: "/signup",
          subsystem: "auth"
        });
    errorRedirect(
      "/signup",
      `${friendlyAuthError(error.message)}${reported ? errorReference(reported) : ""}`
    );
  }

  if (!data.user) {
    errorRedirect("/signup", "Your account could not be created. Please try again.");
  }
  const createdUser = data.user!;

  const { error: registrationError } = await serviceSupabase.rpc(
    "register_profile_for_season_with_code",
    {
      p_invite_code: inviteCode,
      p_profile_id: createdUser.id,
      p_season_id: selectedRegistrationSeason.id
    }
  );

  if (registrationError) {
    console.error("[auth] season registration after signup failed:", registrationError.message);
    await reportAppError({
      actorProfileId: createdUser.id,
      code: "signup-season-registration-failed",
      context: { operation: "register-after-signup", seasonId: selectedRegistrationSeason.id },
      error: registrationError,
      route: "/signup",
      subsystem: "auth"
    });
    messageRedirect(
      "/login",
      "Your account was created. Confirm your email, then enter the season invite code after signing in."
    );
  }

  if (data.session) {
    invalidateScoringCache();
    messageRedirect("/onboarding", "Account created and season registration confirmed.");
  }

  invalidateScoringCache();
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
    const reported = isExpectedAuthError(error.message)
      ? null
      : await reportAppError({
          code: "password-reset-request-failed",
          context: { operation: "request_password_reset" },
          error,
          route: "/forgot-password",
          subsystem: "auth"
        });
    errorRedirect(
      "/forgot-password",
      `${friendlyAuthError(error.message)}${reported ? errorReference(reported) : ""}`
    );
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
  const currentUser = user!;

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    console.error("[auth] updateUser password failed:", error.message);
    const reported = isExpectedAuthError(error.message)
      ? null
      : await reportAppError({
          actorProfileId: currentUser.id,
          code: "password-update-failed",
          context: { operation: "update_password" },
          error,
          route: "/reset-password",
          subsystem: "auth"
        });
    errorRedirect(
      "/reset-password",
      `${friendlyAuthError(error.message)}${reported ? errorReference(reported) : ""}`
    );
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

    const reported = await reportAppError({
      actorProfileId: userId,
      code: "profile-save-failed",
      context: { operation: "save-profile" },
      error,
      route: "/onboarding",
      subsystem: "profile"
    });
    errorRedirect(
      "/onboarding",
      `Your profile could not be saved. Please try again.${errorReference(reported)}`
    );
  }

  messageRedirect(
    "/season-registration",
    "Profile saved. Enter the season invite code to join the active league."
  );
}

export async function setSeasonParticipationAction(formData: FormData) {
  const decision = asText(formData.get("decision"));
  const inviteCode = asText(formData.get("invite_code"));
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
  const currentUser = user!;

  let error: { message: string } | null = null;
  if (decision === "register") {
    if (!inviteCode) {
      errorRedirect("/season-registration", "Enter the season invite code.");
    }

    let activeSeason: Awaited<ReturnType<typeof loadActiveLeagueSeason>> = null;
    try {
      activeSeason = await loadActiveLeagueSeason(supabase);
    } catch (seasonError) {
      const reported = await reportAppError({
        actorProfileId: currentUser.id,
        code: "load-registration-season-failed",
        context: { operation: "season_registration" },
        error: seasonError,
        route: "/season-registration",
        subsystem: "auth"
      });
      errorRedirect(
        "/season-registration",
        `Season registration could not be opened. Please try again.${errorReference(reported)}`
      );
    }
    if (!activeSeason) {
      errorRedirect("/season-registration", "No league season is currently open.");
    }
    const selectedActiveSeason = activeSeason!;

    const serviceSupabase = createServiceRoleSupabaseClient();
    let registrationAttemptAllowed = false;
    try {
      registrationAttemptAllowed = await consumeRegistrationAttempt({
        profileId: currentUser.id,
        supabase: serviceSupabase
      });
    } catch (rateLimitError) {
      console.error(
        "[auth] season registration rate limit failed:",
        rateLimitError instanceof Error ? rateLimitError.message : rateLimitError
      );
      const reported = await reportAppError({
        actorProfileId: currentUser.id,
        code: "registration-rate-limit-failed",
        context: { operation: "season_registration" },
        error: rateLimitError,
        route: "/season-registration",
        subsystem: "auth"
      });
      errorRedirect(
        "/season-registration",
        `Season registration could not be verified. Please try again shortly.${errorReference(reported)}`
      );
    }
    if (!registrationAttemptAllowed) {
      errorRedirect(
        "/season-registration",
        "Too many invite-code attempts. Wait 15 minutes and try again."
      );
    }
    const result = await serviceSupabase.rpc("register_profile_for_season_with_code", {
      p_invite_code: inviteCode,
      p_profile_id: currentUser.id,
      p_season_id: selectedActiveSeason.id
    });
    error = result.error;
  } else {
    const result = await supabase.rpc("set_active_season_participation", {
      p_register: false
    });
    error = result.error;
  }

  if (error) {
    const safeMessage = participantSafeErrorMessage(
      error,
      "Season registration could not be updated. Please try again."
    );
    const reported = safeMessage.startsWith("Season registration could not")
      ? await reportAppError({
          actorProfileId: currentUser.id,
          code: "season-participation-update-failed",
          context: { operation: decision },
          error,
          route: "/season-registration",
          subsystem: "auth"
        })
      : null;
    errorRedirect(
      "/season-registration",
      `${safeMessage}${reported ? errorReference(reported) : ""}`
    );
  }

  invalidateScoringCache();
  const message =
    decision === "register"
      ? "Season registration confirmed."
      : "You will not appear in this season's field. You can change this decision before making picks.";
  messageRedirect(next, message);
}
