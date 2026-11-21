"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Repeat } from "lucide-react";
import { setActiveBusiness } from "@/features/business/server/actions";

export interface BusinessOption {
  id: string;
  name: string;
}

export function BusinessSwitcher({
  businesses,
  activeId
}: {
  businesses: BusinessOption[];
  activeId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string>(activeId ?? businesses[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  async function switchTo(businessId: string) {
    if (businessId === activeId) return;
    setSelected(businessId);
    const result = await setActiveBusiness(businessId);
    if (!result.ok) {
      setError(result.error ?? "تعذر تبديل المشروع");
      return;
    }
    startTransition(() => {
      router.refresh();
    });
  }

  if (businesses.length <= 1) return null;

  return (
    <div className="space-y-1.5">
      <label htmlFor="active-business" className="block text-sm font-medium">
        المشروع النشط
      </label>
      <div className="flex items-center gap-2">
        <select
          id="active-business"
          className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
          value={selected}
          onChange={(event) => switchTo(event.target.value)}
        >
          {businesses.map((business) => (
            <option key={business.id} value={business.id}>
              {business.name}
            </option>
          ))}
        </select>
        {(pending || error) && (
          <span className="flex items-center gap-1 text-xs text-muted">
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {error && <Repeat className="h-4 w-4" aria-hidden />}
          </span>
        )}
      </div>
    </div>
  );
}
