import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
};

export function MobileActionDock({ children, className = "" }: Props) {
  return (
    <div
      className={`mobile-action-dock fixed inset-x-3 z-30 md:hidden ${className}`}
      data-mobile-action-dock
    >
      {children}
    </div>
  );
}
