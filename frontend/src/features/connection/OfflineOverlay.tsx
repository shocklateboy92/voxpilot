import WifiOff from "lucide-solid/icons/wifi-off";
import type { JSX } from "solid-js";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import {
  changeServer,
  client,
  wakeStorageKey,
} from "../../platform/connection";
import { rpc } from "../../platform/rpc";
import { Button } from "../../ui/Button";

const PROBE_INTERVAL = 5_000;
const PROBE_TIMEOUT = 3_000;

async function probeAlive(): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT);
  try {
    // Query string ensures the request bypasses the service worker's
    // NetworkFirst runtime cache rule (whose regex anchors at end-of-string).
    await client.server.info({ signal: ctrl.signal });
    return true;
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
  const [status, setStatus] = createSignal<"idle" | "waking" | "error">("idle");
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
    <div class="flex w-full max-w-sm flex-col items-center gap-3 rounded-2xl border border-border bg-surface px-6 py-8 text-center">
      <WifiOff size={40} />
      <h2 class="text-xl font-semibold text-text">Devbox is offline</h2>
      <p class="text-[0.85rem] text-muted">
        {props.wakeUrl
          ? "The devbox is unreachable. You can try waking it up."
          : "Waiting for connection..."}
      </p>

      <Show when={props.wakeUrl}>
        <Button
          type="button"
          variant="primary"
          class="mt-2 min-w-40"
          onClick={handleWake}
          disabled={status() === "waking"}
        >
          {status() === "waking" ? "Waking..." : "Wake Devbox"}
        </Button>
      </Show>

      <Show when={status() === "error"}>
        <p class="text-[0.8rem] text-error">{errorMsg()}</p>
      </Show>

      <Show when={props.onDismiss}>
        {(dismiss) => (
          <Button type="button" variant="ghost" size="sm" onClick={dismiss()}>
            Dismiss
          </Button>
        )}
      </Show>

      <p class="mt-1 text-xs text-muted">Auto-checking connection...</p>
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
      const data = await rpc.config({});
      if (data.wakeUrl) {
        setWakeUrl(data.wakeUrl);
        localStorage.setItem(wakeStorageKey, data.wakeUrl);
      }
    } catch {
      const stored = localStorage.getItem(wakeStorageKey);
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
        <div class="fixed inset-0 z-300 flex flex-col items-center justify-center gap-3 bg-overlay p-4">
          <Button onClick={changeServer}>Connection settings</Button>
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
