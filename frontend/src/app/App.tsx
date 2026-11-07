/**
 * Root application component.
 *
 * This module is dynamically imported by index.tsx. By the time it executes,
 * store.ts has completed its top-level await (init) and all module-scope
 * side effects in the import graph (including streaming.ts's SSE listener)
 * have activated.
 */

import { MetaProvider, Title } from "@solidjs/meta";
import { Route, Router, type RouteSectionProps } from "@solidjs/router";
import { ErrorBoundary } from "solid-js";
import { serverUrl } from "../platform/connection";
import { Button } from "../ui/Button";
import { ChatView } from "./ChatView";
import { useSessionNavigation } from "./navigation";
import { useAppRouting } from "./routing";
import { ToastContainer } from "./ToastContainer";
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
        <Router root={AppRoutes} explicitLinks preload={false}>
          <Route path="*path" component={ChatView} />
        </Router>
        <ToastContainer />
      </ErrorBoundary>
    </MetaProvider>
  );
}

function AppRoutes(props: RouteSectionProps) {
  useAppRouting();
  useSessionNavigation();
  return <>{props.children}</>;
}

function AppError(props: { error: unknown }) {
  const message = () => {
    const err = props.error;
    return err instanceof Error ? err.message : "An unexpected error occurred";
  };

  return (
    <main class="app relative flex size-full flex-col overflow-hidden bg-surface px-3 pb-[calc(var(--bottom-nav-height)+var(--safe-bottom))] text-center">
      <h1 class="mb-4 text-3xl font-bold tracking-tight">VoxPilot</h1>
      <div class="p-8 text-center text-error">
        <p>Something went wrong:</p>
        <pre class="my-4 rounded-lg bg-surface p-4 text-left text-[0.85rem] wrap-break-word whitespace-pre-wrap">
          {message()}
        </pre>
        <Button
          type="button"
          variant="primary"
          onClick={() => window.location.reload()}
        >
          Reload
        </Button>
      </div>
    </main>
  );
}
