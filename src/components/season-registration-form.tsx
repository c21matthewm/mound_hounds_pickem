"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { setSeasonParticipationAction, submitSeasonRegistrationFormAction, type SeasonRegistrationError } from "@/app/actions/auth";
import { usePwa } from "@/components/pwa-provider";
import { SeasonInviteCodeHelp } from "@/components/season-invite-code-help";
import { SeasonInviteCodeInput } from "@/components/season-invite-code-input";
import { SubmitButton } from "@/components/submit-button";
import { CompactNotice, FormField, actionControlClassName, fieldControlClassName } from "@/components/ui-primitives";

type Props = {
  adminEmail: string;
  canJoin: boolean;
  canSkip: boolean;
  next: string;
  seasonYear: number;
};

export function SeasonRegistrationForm({ adminEmail, canJoin, canSkip, next, seasonYear }: Props) {
  const { isOffline } = usePwa();
  const errorId = useId();
  const submitting = useRef(false);
  const [pending, setPending] = useState<"register" | "decline" | null>(null);
  const [error, setError] = useState<SeasonRegistrationError | null>(null);
  const codeError = error?.field === "invite_code";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current || isOffline || navigator.onLine === false) return;

    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const form = new FormData(event.currentTarget, submitter);
    const decision = form.get("decision");
    if ((decision === "register" && !canJoin) || (decision === "decline" && !canSkip)) return;
    if (decision !== "register" && decision !== "decline") return;

    if (decision === "decline") form.delete("invite_code");

    submitting.current = true;
    setPending(decision);
    setError(null);
    try {
      const result = await setSeasonParticipationAction(form);
      // On success the action redirects. A returned error leaves the invite code in the field.
      if (result) setError(result);
    } catch {
      setError({ message: "Season registration could not be confirmed. Please try again." });
    } finally {
      submitting.current = false;
      setPending(null);
    }
  };

  return (
    <form action={submitSeasonRegistrationFormAction} className="grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit}>
      <input name="next" type="hidden" value={next} />
      {error && !codeError ? (
        <CompactNotice className="sm:col-span-2" role="alert" tone="danger">{error.message}</CompactNotice>
      ) : null}
      <div className="sm:col-span-2">
        <FormField
          description="The code confirms that this permanent account belongs in the private league."
          label="Season invite code"
        >
          <SeasonInviteCodeInput
            required
            aria-describedby={codeError ? errorId : undefined}
            aria-invalid={codeError || undefined}
            autoCapitalize="none"
            autoComplete="off"
            className={fieldControlClassName()}
            disabled={!canJoin}
            maxLength={64}
            minLength={8}
            name="invite_code"
            onChange={() => { if (codeError) setError(null); }}
            readOnly={pending !== null}
            type="text"
          />
        </FormField>
        {codeError ? <p className="mt-1 text-sm text-red-800" id={errorId} role="alert">{error.message}</p> : null}
      </div>
      <div className="sm:col-span-2">
        <SeasonInviteCodeHelp adminEmail={adminEmail} seasonYear={seasonYear} />
      </div>
      {!canJoin ? (
        <CompactNotice className="sm:col-span-2" tone="warning">
          Registration is waiting for the league administrator to configure this season&apos;s invite code.
        </CompactNotice>
      ) : null}
      <SubmitButton disabled={!canJoin || pending !== null} name="decision" value="register">
        {pending === "register" ? "Joining season..." : "Join " + seasonYear + " season"}
      </SubmitButton>
      {canSkip ? (
        <SubmitButton className={actionControlClassName("secondary")} disabled={pending !== null} formNoValidate name="decision" value="decline">
          {pending === "decline" ? "Saving decision..." : "Skip this season"}
        </SubmitButton>
      ) : null}
    </form>
  );
}
