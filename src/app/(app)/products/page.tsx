import type { Metadata } from "next";
import { ProductsGate } from "@/features/inventory/components/products-gate";
import { getSessionUser } from "@/features/auth/server/session";
import { getActiveBusinessId } from "@/features/business/server/business-context";
import { getAppShellData } from "@/features/business/server/app-shell-data";

export const metadata: Metadata = {
  title: "المنتجات | المساعد المالي"
};

export default async function ProductsPage() {
  const [user, activeId] = await Promise.all([
    getSessionUser(),
    getActiveBusinessId()
  ]);

  const shell = await getAppShellData(user?.id ?? null, activeId);
  const canManage = user ? shell.role !== "employee" : true;

  return <ProductsGate canManage={canManage} />;
}
