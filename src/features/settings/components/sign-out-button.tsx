"use client";

import { useState } from "react";
import { LogOut, Loader2 } from "lucide-react";
import { isSupabaseConfigured } from "@/core/supabase/client";
import { signOut } from "@/features/auth/services/auth-service";

export function SignOutButton({
  className = "btn-outline",
  showLabel = true
}: {
  className?: string;
  showLabel?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const configured = isSupabaseConfigured();

  if (!configured) return null;

  async function handleClick() {
    setBusy(true);
    try {
      await signOut();
    } finally {
      window.location.assign("/login");
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className={className}
      aria-label="تسجيل الخروج"
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <LogOut className="h-4 w-4" aria-hidden />
      )}
      {showLabel && <span>تسجيل الخروج</span>}
    </button>
  );
}
