import type { Metadata } from "next";
import { DashboardPageClient } from "@/features/dashboard/components/dashboard-page-client";

export const metadata: Metadata = {
  title: "لوحة التحكم"
};

export default function DashboardPage() {
  return <DashboardPageClient />;
}
