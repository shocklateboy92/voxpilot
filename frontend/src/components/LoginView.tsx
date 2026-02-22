/**
 * Login view — GitHub Copilot device flow sign-in.
 */

import { createSignal, onCleanup, Show } from "solid-js";
import { startDeviceFlow, pollDeviceFlow } from "../api-client";

type FlowState =
  | { kind: "idle" }
  | { kind: "waiting"; user_code: string; verification_uri: string; interval: number; checking: boolean }
  | { kind: "error"; message: string };

export function LoginView() {
  const [flow, setFlow] = createSignal<FlowState>({ kind: "idle" });
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  onCleanup(() => {
    if (pollTimer !== null) clearTimeout(pollTimer);
  });

  async function handleSignIn() {
    try {
      const result = await startDeviceFlow();
      setFlow({
        kind: "waiting",
        user_code: result.user_code,
        verification_uri: result.verification_uri,
        interval: result.interval,
        checking: false,
      });
      schedulePoll(result.user_code, result.verification_uri, result.interval);
    } catch (err) {
      setFlow({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to start sign-in",
      });
    }
  }

  function schedulePoll(
    user_code: string,
    verification_uri: string,
    interval: number,
  ) {
    pollTimer = setTimeout(
      () => void doPoll(user_code, verification_uri, interval),
      interval * 1000,
    );
  }

  async function doPoll(
    user_code: string,
    verification_uri: string,
    interval: number,
  ) {
    setFlow({ kind: "waiting", user_code, verification_uri, interval, checking: true });
    try {
      const result = await pollDeviceFlow();
      if (result.status === "ok") {
        window.location.reload();
        return;
      }
      if (result.status === "pending") {
        setFlow({ kind: "waiting", user_code, verification_uri, interval, checking: false });
        schedulePoll(user_code, verification_uri, interval);
        return;
      }
      setFlow({
        kind: "error",
        message: result.detail ?? "Authentication failed. Please try again.",
      });
    } catch (err) {
      setFlow({
        kind: "error",
        message: err instanceof Error ? err.message : "Poll failed",
      });
    }
  }

  function handleCopyCode() {
    const f = flow();
    if (f.kind === "waiting") {
      void navigator.clipboard.writeText(f.user_code);
    }
  }

  return (
    <main id="app">
      <h1>VoxPilot</h1>
      <div id="login-view">
        <Show when={flow().kind === "idle" || flow().kind === "error"}>
          <p>Sign in with GitHub to start chatting with AI models.</p>
          <Show when={flow().kind === "error"}>
            <p class="login-error">
              {(flow() as { kind: "error"; message: string }).message}
            </p>
          </Show>
          <button
            type="button"
            class="btn btn-github"
            onClick={() => void handleSignIn()}
          >
            Sign in with GitHub
          </button>
        </Show>

        <Show when={flow().kind === "waiting"}>
          <p>Enter this code on GitHub to authorize VoxPilot:</p>
          <div class="device-code">
            <span class="device-code-value">
              {flow().kind === "waiting"
                ? (flow() as { kind: "waiting"; user_code: string }).user_code
                : ""}
            </span>
            <button
              type="button"
              class="btn btn-copy"
              onClick={handleCopyCode}
            >
              Copy
            </button>
          </div>
          <a
            href={
              flow().kind === "waiting"
                ? (flow() as { kind: "waiting"; verification_uri: string }).verification_uri
                : ""
            }
            target="_blank"
            rel="noopener noreferrer"
            class="btn btn-github"
          >
            Open GitHub →
          </a>
          <p class="login-polling">
            {flow().kind === "waiting" &&
            (flow() as { kind: "waiting"; checking: boolean }).checking
              ? "Checking…"
              : "Waiting for authorization…"}
          </p>
        </Show>
      </div>
    </main>
  );
}
