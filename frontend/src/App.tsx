/**
 * Root application component.
 *
 * Goes directly to ChatView — no auth required for self-hosted mode.
 * Wraps the tree in an ErrorBoundary to catch unhandled render errors.
 */

import { ErrorBoundary } from "solid-js";
import { ChatView } from "./components/ChatView";
import { ToastContainer } from "./components/ToastContainer";
import "./style.css";

export function App() {
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
