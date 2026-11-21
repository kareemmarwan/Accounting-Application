import Link from "next/link";
import { LayoutDashboard } from "lucide-react";

export default function AuthLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
      <div className="mb-8 flex flex-col items-center gap-2">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <LayoutDashboard className="h-6 w-6" aria-hidden />
          </span>
          <span className="text-xl font-bold">المساعد المالي</span>
        </Link>
        <p className="text-sm text-muted">إدارة مشروعك المالية ببساطة</p>
      </div>
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}
