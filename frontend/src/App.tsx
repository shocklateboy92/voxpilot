/**
 * Root application component.
 *
 * This module is dynamically imported by index.tsx. By the time it executes,
 * store.ts has completed its top-level await (init) and all module-scope
 * side effects in the import graph (including streaming.ts's SSE listener)
 * have activated.
 */

import { ErrorBoundary } from "solid-js";
import { ChatView } from "./components/ChatView";
import { ToastContainer } from "./components/ToastContainer";
import "./wake-lock"; // Keep screen awake while AI sessions are busy

export default function App() {
  return (
    <ErrorBoundary fallback={(err) => <AppError error={err} />}>
      <ChatView />
      <ToastContainer />
    </ErrorBoundary>
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
        <button class="btn btn-primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </main>
  );
}
