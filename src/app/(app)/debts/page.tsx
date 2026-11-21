import type { Metadata } from "next";
import { DebtsPageClient } from "@/features/debts/components/debts-page-client";

export const metadata: Metadata = {
  title: "الديون"
};

export default function DebtsPage() {
  return <DebtsPageClient />;
}
