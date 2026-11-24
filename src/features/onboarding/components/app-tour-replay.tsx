"use client";

import { RotateCcw } from "lucide-react";
import { APP_TOUR_KEY } from "@/features/onboarding/components/app-tour";

export function AppTourReplay() {
  return (
    <button
      type="button"
      data-tour="tour-replay"
      onClick={() => {
        try {
          window.localStorage.removeItem(APP_TOUR_KEY);
        } catch {
          void 0;
        }
        window.dispatchEvent(new Event("musaed:replay-tour"));
      }}
      className="btn-outline text-xs"
    >
      <RotateCcw className="h-4 w-4" aria-hidden />
      إعادة الجولة التعليمية
    </button>
  );
}
