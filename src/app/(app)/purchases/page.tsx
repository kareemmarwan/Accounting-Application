import type { Metadata } from "next";
import { PurchasesPageClient } from "@/features/purchases/components/purchases-page-client";

export const metadata: Metadata = {
  title: "المشتريات"
};

export default function PurchasesPage() {
  return <PurchasesPageClient />;
}
