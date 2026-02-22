/**
 * Root application component.
 *
 * Checks auth on mount, then shows either LoginView or ChatView.
 * Wraps the tree in an ErrorBoundary to catch unhandled render errors.
 */

import { Show, ErrorBoundary, onMount } from "solid-js";
import { user, authChecked, setUser, setAuthChecked } from "./store";
import { fetchCurrentUser } from "./api-client";
import { LoginView } from "./components/LoginView";
import { ChatView } from "./components/ChatView";
import { ToastContainer } from "./components/ToastContainer";
import "./style.css";

export function App() {
  onMount(async () => {
    const u = await fetchCurrentUser();
    setUser(u ?? null);
    setAuthChecked(true);
  });

  return (
    <ErrorBoundary fallback={(err) => <AppError error={err} />}>
      <Show when={authChecked()} fallback={<Loading />}>
        <Show when={user()} fallback={<LoginView />}>
          {(u) => <ChatView user={u()} />}
        </Show>
      </Show>
      <ToastContainer />
    </ErrorBoundary>
  );
}

function Loading() {
  return (
    <main id="app">
      <h1>VoxPilot</h1>
      <p class="status-text">Loading…</p>
    </main>
  );
}

function AppError(props: { error: unknown }) {
  const message = () => {
    const err = props.error;
    return err instanceof Error ? err.message : "An unexpected error occurred";
  };

  return (
    <main id="app">
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
