/**
 * Root application component.
 *
 * This module is dynamically imported by index.tsx. By the time it executes,
 * store.ts has completed its top-level await (init) and all module-scope
 * side effects in the import graph (including streaming.ts's SSE listener)
 * have activated.
 */

import { MetaProvider, Title } from "@solidjs/meta";
import { ErrorBoundary } from "solid-js";
import { ChatView } from "./components/ChatView";
import { ToastContainer } from "./components/ToastContainer";
import { serverUrl } from "./connection";
import "./wake-lock"; // Keep screen awake while AI sessions are busy

// The static frontend may connect to many hosts; label tabs by the API host.
function pageTitle(): string {
  const base = "VoxPilot";
  const host = new URL(serverUrl).hostname;
  const firstLabel = host.split(".")[0] ?? "";
  const isIp = /^\d+(\.\d+){3}$/.test(host) || host.includes(":");
  const isLocal = host === "localhost" || isIp;
  const prefix = isLocal ? "dev" : firstLabel;
  return prefix ? `${prefix} ${base}` : base;
}

export default function App() {
  return (
    <MetaProvider>
      <Title>{pageTitle()}</Title>
      <ErrorBoundary fallback={(err) => <AppError error={err} />}>
        <ChatView />
        <ToastContainer />
      </ErrorBoundary>
    </MetaProvider>
  );
}

function AppError(props: { error: unknown }) {
  const message = () => {
    const err = props.error;
    return err instanceof Error ? err.message : "An unexpected error occurred";
  };

  return (
    <main class="app">
      <h1>VoxPilot</h1>
      <div class="app-error">
        <p>Something went wrong:</p>
        <pre>{message()}</pre>
        <button
          type="button"
          class="btn btn-primary"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    </main>
  );
}
