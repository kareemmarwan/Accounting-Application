import type { Metadata } from "next";
import { ExpensesPageClient } from "@/features/expenses/components/expenses-page-client";

export const metadata: Metadata = {
  title: "المصروفات"
};

export default function ExpensesPage() {
  return <ExpensesPageClient />;
}
