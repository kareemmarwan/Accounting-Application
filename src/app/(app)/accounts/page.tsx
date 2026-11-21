import type { Metadata } from "next";
import { AccountsPageClient } from "@/features/accounts/components/accounts-page-client";

export const metadata: Metadata = {
  title: "الحسابات المالية"
};

export default function AccountsPage() {
  return <AccountsPageClient />;
}
