import type { Metadata } from "next";
import { RegisterForm } from "@/features/auth/components/register-form";

export const metadata: Metadata = {
  title: "إنشاء حساب"
};

export default function RegisterPage() {
  return <RegisterForm />;
}
