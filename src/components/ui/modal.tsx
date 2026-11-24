"use client";

import { useEffect } from "react";

export type ModalSize = "sm" | "md" | "lg" | "xl";

const SIZES: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-3xl"
};

interface ModalProps {
  open: boolean;
  onClose: () => void;
  label: string;
  size?: ModalSize;
  className?: string;
  children: React.ReactNode;
}

export function Modal({
  open,
  onClose,
  label,
  size = "md",
  className,
  children
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-foreground/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <div
        className={`card max-h-[calc(100dvh-2rem)] w-full overflow-y-auto shadow-2xl ${SIZES[size]} ${
          className ?? ""
        }`}
      >
        {children}
      </div>
    </div>
  );
}
