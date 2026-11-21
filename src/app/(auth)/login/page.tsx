import type { Metadata } from "next";
import { LoginForm } from "@/features/auth/components/login-form";

export const metadata: Metadata = {
  title: "تسجيل الدخول"
};

function sanitizeNext(value: string | string[] | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!value.startsWith("/") || value.startsWith("//")) return undefined;
  return value;
}

export default function LoginPage({
  searchParams
}: {
  searchParams?: { next?: string | string[] };
}) {
  return <LoginForm nextPath={sanitizeNext(searchParams?.next)} />;
}
