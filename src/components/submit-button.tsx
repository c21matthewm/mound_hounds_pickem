"use client";

import { useFormStatus } from "react-dom";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { actionControlClassName } from "@/components/ui-primitives";

type SubmitButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "disabled" | "type"
> & {
  children: ReactNode;
  disabled?: boolean;
  pendingLabel?: string;
};

export function SubmitButton({
  children,
  className = actionControlClassName("primary"),
  disabled = false,
  pendingLabel = "Saving...",
  ...buttonProps
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  const isDisabled = disabled || pending;

  return (
    <button
      {...buttonProps}
      aria-disabled={isDisabled}
      className={className}
      disabled={isDisabled}
      type="submit"
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
