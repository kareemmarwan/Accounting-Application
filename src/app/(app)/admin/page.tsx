import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  fetchAdminOverview,
  isPlatformAdmin
} from "@/features/admin/services/admin-service";
import { AdminPageClient } from "@/features/admin/components/admin-page-client";

export const metadata: Metadata = {
  title: "إدارة المنصة"
};

export default async function AdminPage() {
  const isAdmin = await isPlatformAdmin();
  if (!isAdmin) notFound();

  const overviewRes = await fetchAdminOverview();
  if (!overviewRes.ok) {
    return (
      <div className="card">
        <p className="text-sm font-medium text-danger">{overviewRes.error}</p>
      </div>
    );
  }

  return <AdminPageClient overview={overviewRes.overview} />;
}
