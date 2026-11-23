import { Loader2 } from "lucide-react";

export default function AppLoading() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
      <span className="relative flex h-14 w-14 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
        </span>
      </span>
      <p className="text-sm font-bold">جارٍ التحميل...</p>
      <p className="text-xs text-muted">
        بياناتك على جهازك — لحظة فقط حتى الاكتمال
      </p>
    </div>
  );
}
