import type { Metadata } from "next";
import { ProductsGate } from "@/features/inventory/components/products-gate";
import { getSupabaseServerClient } from "@/core/supabase/server";
import { getSessionUser } from "@/features/auth/server/session";
import { getActiveBusinessId } from "@/features/business/server/business-context";

export const metadata: Metadata = {
  title: "المنتجات | المساعد المالي"
};

export default async function ProductsPage() {
  const [user, activeId, supabase] = await Promise.all([
    getSessionUser(),
    getActiveBusinessId(),
    getSupabaseServerClient()
  ]);

  let canManage = true;
  if (supabase && activeId) {
    const membershipRes = await supabase
      .from("business_members")
      .select("role")
      .eq("business_id", activeId)
      .eq("user_id", user?.id ?? "")
      .maybeSingle();
    const role = (membershipRes.data as { role?: string } | null)?.role;
    canManage = role !== "employee";
  }

  return <ProductsGate canManage={canManage} />;
}
