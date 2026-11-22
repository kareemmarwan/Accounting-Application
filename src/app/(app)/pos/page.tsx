import type { Metadata } from "next";
import { PosPageClient } from "@/features/pos/components/pos-page-client";

export const metadata: Metadata = {
  title: "الكاشير | المساعد المالي"
};

export default function PosPage() {
  return <PosPageClient />;
}
