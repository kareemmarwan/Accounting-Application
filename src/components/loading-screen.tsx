"use client";

export function LoadingScreen({
  label = "جارٍ التحميل...",
  fullScreen = false
}: {
  label?: string;
  fullScreen?: boolean;
}) {
  const spinner = (
    <span
      className="inline-block h-8 w-8 animate-spin rounded-full border-[3px] border-primary/20 border-t-primary"
      role="status"
      aria-hidden
    />
  );

  if (fullScreen) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        {spinner}
        <p className="text-sm font-medium text-muted">{label}</p>
      </div>
    );
  }

  return (
    <div className="card flex min-h-[40vh] flex-col items-center justify-center gap-3">
      {spinner}
      <p className="text-sm font-medium text-muted">{label}</p>
    </div>
  );
}
