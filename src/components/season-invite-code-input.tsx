"use client";
import { useEffect, useRef } from "react";
import type { InputHTMLAttributes } from "react";
import { inviteCodeFromFragment } from "@/lib/season-invite-links";
export function SeasonInviteCodeInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const code = inviteCodeFromFragment(window.location.hash);
    if (code && input.current && !input.current.value) input.current.value = code;
    // Keep the private code out of subsequent navigation, copying, and screenshots of the URL.
    if (new URLSearchParams(window.location.hash.slice(1)).has("code")) {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      fragment.delete("code");
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${fragment.size ? `#${fragment}` : ""}`);
    }
  }, []);
  return <input {...props} ref={input} />;
}
