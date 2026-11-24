export function withTimeout<T>(
  promise: Promise<T>,
  fallback: T,
  timeoutMs = 3000
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), timeoutMs);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function safeQuery<R>(
  run: () => PromiseLike<R>,
  fallback: R | null,
  timeoutMs = 4000
): Promise<R | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      Promise.resolve(run()).catch(() => fallback),
      new Promise<R | null>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
