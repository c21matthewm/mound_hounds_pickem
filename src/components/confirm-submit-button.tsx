"use client";

import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";

type ConfirmSubmitButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "type"
> & {
  children: ReactNode;
  confirmMessage: string;
  type?: "button" | "submit";
};

export function ConfirmSubmitButton({
  children,
  className,
  confirmMessage,
  formNoValidate = false,
  onClick,
  type = "submit",
  ...buttonProps
}: ConfirmSubmitButtonProps) {
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
      className={className}
      formNoValidate={formNoValidate}
      onClick={handleClick}
      type={type}
    >
      {children}
    </button>
  );
}
