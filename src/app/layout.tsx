import type { Metadata, Viewport } from "next";
import "@fontsource/cairo/400.css";
import "@fontsource/cairo/500.css";
import "@fontsource/cairo/600.css";
import "@fontsource/cairo/700.css";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/service-worker-register";

export const metadata: Metadata = {
  title: {
    default: "المساعد المالي",
    template: "%s | المساعد المالي"
  },
  description:
    "مساعد محاسبي ومالي ذكي للمشاريع الصغيرة — يعمل مع الإنترنت وبدونه، ويحوّل عملياتك اليومية إلى تقارير مالية واضحة.",
  manifest: "/manifest.webmanifest",
  applicationName: "المساعد المالي",
  icons: {
    icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/icon-192.png" }]
  },
  appleWebApp: {
    capable: true,
    title: "المساعد المالي",
    statusBarStyle: "default"
  }
};

export const viewport: Viewport = {
  themeColor: "#16A34A",
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body className="font-sans min-h-screen flex flex-col">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
