/** Share one best-effort screen wake lock across active browser activities. */
const requests = new Set<symbol>();
let sentinel: WakeLockSentinel | undefined;
let acquiring = false;

async function acquire(): Promise<void> {
  if (
    !("wakeLock" in navigator) ||
    document.visibilityState !== "visible" ||
    requests.size === 0 ||
    sentinel ||
    acquiring
  )
    return;

  acquiring = true;
  try {
    const acquired = await navigator.wakeLock.request("screen");
    if (requests.size === 0) {
      void acquired.release();
      return;
    }
    sentinel = acquired;
    acquired.addEventListener("release", () => {
      if (sentinel === acquired) sentinel = undefined;
    });
  } catch {
    // Hidden pages, power-saving policies and unsupported contexts can deny it.
  } finally {
    acquiring = false;
  }
}

/** Returns an idempotent cleanup; releasing one activity preserves the others. */
export function requestScreenWakeLock(): () => void {
  const request = Symbol();
  requests.add(request);
  void acquire();
  return () => {
    requests.delete(request);
    if (requests.size === 0 && sentinel) {
      const active = sentinel;
      sentinel = undefined;
      void active.release();
    }
  };
}

// Browsers release wake locks when hidden. Restore only still-active requests.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void acquire();
});
