import type { JSX } from "solid-js";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import WifiOff from "lucide-solid/icons/wifi-off";
import { rpc } from "../rpc";

const PROBE_INTERVAL = 5_000;
const PROBE_TIMEOUT = 3_000;

async function probeAlive(): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT);
  try {
    // Query string ensures the request bypasses the service worker's
    // NetworkFirst runtime cache rule (whose regex anchors at end-of-string).
    const r = await fetch("/api/config?probe=1", {
      cache: "no-store",
      signal: ctrl.signal,
    });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function OfflineCard(props: {
  wakeUrl: string | null;
  onDismiss?: () => void;
  onConnected: () => void;
}) {
  const [status, setStatus] = createSignal<"idle" | "waking" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = createSignal("");

  async function runProbe() {
    const alive = await probeAlive();
    if (alive) {
      props.onConnected();
    }
  }

  onMount(() => void runProbe());

  const pollTimer = setInterval(() => void runProbe(), PROBE_INTERVAL);
  onCleanup(() => clearInterval(pollTimer));

  async function handleWake() {
    const url = props.wakeUrl;
    if (!url) return;

    setStatus("waking");
    setErrorMsg("");

    try {
      await fetch(url, { method: "POST", mode: "no-cors" });
    } catch {
      setStatus("error");
      setErrorMsg("Failed to send wake request. Will keep trying...");
    }
  }

  return (
    <div class="offline-card">
      <WifiOff size={40} />
      <h2 class="offline-title">Devbox is offline</h2>
      <p class="offline-subtitle">
        {props.wakeUrl
          ? "The devbox is unreachable. You can try waking it up."
          : "Waiting for connection..."}
      </p>

      <Show when={props.wakeUrl}>
        <button
          class="btn offline-wake-btn"
          onClick={handleWake}
          disabled={status() === "waking"}
        >
          {status() === "waking" ? "Waking..." : "Wake Devbox"}
        </button>
      </Show>

      <Show when={status() === "error"}>
        <p class="offline-error">{errorMsg()}</p>
      </Show>

      <Show when={props.onDismiss}>
        {(dismiss) => (
          <button class="btn btn-ghost offline-dismiss-btn" onClick={dismiss()}>
            Dismiss
          </button>
        )}
      </Show>

      <p class="offline-poll-hint">Auto-checking connection...</p>
    </div>
  );
}

// ── Wrapper overlay (mid-session connectivity loss) ─────────────────────────
// Always renders children. Shows a fixed overlay on top when the backend is
// unreachable. Used in index.tsx to wrap the entire app.

export function OfflineOverlay(props: { children: JSX.Element }) {
  const [offline, setOffline] = createSignal(false);
  const [dismissed, setDismissed] = createSignal(false);
  const [wakeUrl, setWakeUrl] = createSignal<string | null>(null);

  let wasOffline = false;

  async function runProbe() {
    const alive = await probeAlive();
    if (alive) {
      setOffline(false);
    } else {
      if (!wasOffline) {
        // New offline episode — reset dismissed state
        setDismissed(false);
      }
      setOffline(true);
    }
    wasOffline = !alive;
  }

  onMount(async () => {
    // Fetch wake URL from SW-cached config, fall back to localStorage
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

    // Initial probe + start polling
    await runProbe();
  });

  const pollTimer = setInterval(() => void runProbe(), PROBE_INTERVAL);
  onCleanup(() => clearInterval(pollTimer));

  return (
    <>
      {props.children}
      <Show when={offline() && !dismissed()}>
        <div class="offline-overlay">
          <OfflineCard
            wakeUrl={wakeUrl()}
            onDismiss={() => setDismissed(true)}
            onConnected={() => {
              setOffline(false);
            }}
          />
        </div>
      </Show>
    </>
  );
}
