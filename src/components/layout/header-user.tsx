"use client";

import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/core/supabase/client";
import { signOut } from "@/features/auth/services/auth-service";
import { useRouter } from "next/navigation";

export function HeaderUser() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const configured = isSupabaseConfigured();

  useEffect(() => {
    if (!configured) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    client.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
  }, [configured]);

  if (!configured || !email) return null;

  async function handleSignOut() {
    setBusy(true);
    try {
      await signOut();
      router.replace("/login");
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span
        dir="ltr"
        className="hidden max-w-[180px] truncate rounded-full bg-muted-foreground/10 px-3 py-1 text-xs text-muted sm:inline"
      >
        {email}
      </span>
      <button
        type="button"
        onClick={handleSignOut}
        disabled={busy}
        className="rounded-xl p-2 text-muted transition-colors hover:bg-muted-foreground/10 hover:text-foreground"
        aria-label="تسجيل الخروج"
      >
        <LogOut className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
