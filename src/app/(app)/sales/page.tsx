import type { Metadata } from "next";
import { SalesPageClient } from "@/features/sales/components/sales-page-client";

export const metadata: Metadata = {
  title: "المبيعات"
};

export default function SalesPage() {
  return <SalesPageClient />;
}
