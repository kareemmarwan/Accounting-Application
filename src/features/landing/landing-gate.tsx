"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/core/supabase/client";
import { LoadingScreen } from "@/components/loading-screen";

export function LandingGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "landing">("checking");

  useEffect(() => {
    let active = true;
    void (async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        if (active) setState("landing");
        return;
      }
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          navigator.serviceWorker?.controller?.postMessage({
            type: "PRECACHE_APP_SHELL"
          });
          window.location.replace("/dashboard");
          return;
        }
      } catch {
        void 0;
      }
      if (active) setState("landing");
    })();
    return () => {
      active = false;
    };
  }, []);

  if (state === "checking") {
    return <LoadingScreen fullScreen />;
  }

  return <>{children}</>;
}
