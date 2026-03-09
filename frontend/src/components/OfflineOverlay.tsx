import { createSignal, onCleanup, onMount } from "solid-js";
import WifiOff from "lucide-solid/icons/wifi-off";
import { rpc } from "../rpc";

export function OfflineOverlay() {
  const [wakeUrl, setWakeUrl] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<"idle" | "waking" | "error">("idle");
  const [errorMsg, setErrorMsg] = createSignal("");

  onMount(async () => {
    // Try to get wake URL from SW-cached config endpoint, fall back to localStorage
    try {
      const r = await rpc.api.config.$get();
      const data = await r.json();
      if (data.wakeUrl) {
        setWakeUrl(data.wakeUrl);
        localStorage.setItem("voxpilot:wakeUrl", data.wakeUrl);
      }
    } catch {
      const stored = localStorage.getItem("voxpilot:wakeUrl");
      if (stored) setWakeUrl(stored);
    }
  });

  // Auto-poll: check if devbox is back every 5s
  const pollTimer = setInterval(async () => {
    try {
      const r = await fetch("/api/config", { cache: "no-store" });
      if (r.ok) location.reload();
    } catch {
      // still offline
    }
  }, 5000);

  onCleanup(() => clearInterval(pollTimer));

  async function handleWake() {
    const url = wakeUrl();
    if (!url) return;

    setStatus("waking");
    setErrorMsg("");

    try {
      await fetch(url, { method: "POST", mode: "no-cors" });

      // Start faster polling after wake request
      const fastPoll = setInterval(async () => {
        try {
          const r = await fetch("/api/config", { cache: "no-store" });
          if (r.ok) {
            clearInterval(fastPoll);
            location.reload();
          }
        } catch {
          // still waking
        }
      }, 3000);

      // Stop fast polling after 2 minutes
      setTimeout(() => clearInterval(fastPoll), 120_000);
    } catch {
      setStatus("error");
      setErrorMsg("Failed to send wake request. Will keep trying...");
    }
  }

  return (
    <div class="offline-overlay">
      <div class="offline-card">
        <WifiOff size={40} />
        <h2 class="offline-title">Devbox is offline</h2>
        <p class="offline-subtitle">
          {wakeUrl()
            ? "The devbox is unreachable. You can try waking it up."
            : "Waiting for connection..."}
        </p>

        {wakeUrl() && (
          <button
            class="btn offline-wake-btn"
            onClick={handleWake}
            disabled={status() === "waking"}
          >
            {status() === "waking" ? "Waking..." : "Wake Devbox"}
          </button>
        )}

        {status() === "error" && (
          <p class="offline-error">{errorMsg()}</p>
        )}

        <p class="offline-poll-hint">Auto-checking connection...</p>
      </div>
    </div>
  );
}
