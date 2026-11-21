import type { Metadata } from "next";
import { ContactsPageClient } from "@/features/contacts/components/contacts-page-client";

export const metadata: Metadata = {
  title: "العملاء والموردون"
};

export default function ContactsPage() {
  return <ContactsPageClient />;
}
