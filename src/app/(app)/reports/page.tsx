import type { Metadata } from "next";
import { ReportsPageClient } from "@/features/reports/components/reports-page-client";

export const metadata: Metadata = {
  title: "التقارير"
};

export default function ReportsPage() {
  return <ReportsPageClient />;
}
