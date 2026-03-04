/**
 * Root application component.
 *
 * This module is lazy-loaded by index.tsx. By the time it executes,
 * store.ts has already completed its top-level await (init), so
 * the store is fully populated. We just need to start SSE streaming
 * and render the app shell.
 */

import { ErrorBoundary } from "solid-js";
import { ChatView } from "./components/ChatView";
import { ToastContainer } from "./components/ToastContainer";
import { startStreaming } from "./streaming";

// Activate SSE listener + reactive message loading.
// The store is guaranteed to exist (store.ts TLA completed before this module loaded).
startStreaming();

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
        <button class="btn" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </main>
  );
}
