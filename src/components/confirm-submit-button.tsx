"use client";

import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import { useFormStatus } from "react-dom";

type ConfirmSubmitButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "type"
> & {
  children: ReactNode;
  confirmMessage: string;
  pendingLabel?: string;
  type?: "button" | "submit";
};

export function ConfirmSubmitButton({
  children,
  className,
  confirmMessage,
  formNoValidate = false,
  onClick,
  pendingLabel = "Working...",
  type = "submit",
  ...buttonProps
}: ConfirmSubmitButtonProps) {
  const { pending } = useFormStatus();
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (!window.confirm(confirmMessage)) {
      event.preventDefault();
      return;
    }

    onClick?.(event);
  };

  return (
    <button
      {...buttonProps}
      aria-disabled={pending || buttonProps.disabled}
      className={className}
      disabled={pending || buttonProps.disabled}
      formNoValidate={formNoValidate}
      onClick={handleClick}
      type={type}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
