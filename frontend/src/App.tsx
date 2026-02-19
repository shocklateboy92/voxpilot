/**
 * Root application component.
 *
 * Checks auth on mount, then shows either LoginView or ChatView.
 */

import { Show, onMount } from "solid-js";
import { user, authChecked, setUser, setAuthChecked } from "./store";
import { fetchCurrentUser } from "./api-client";
import { LoginView } from "./components/LoginView";
import { ChatView } from "./components/ChatView";
import "./style.css";

export function App() {
  onMount(async () => {
    const u = await fetchCurrentUser();
    setUser(u ?? null);
    setAuthChecked(true);
  });

  return (
    <Show when={authChecked()} fallback={<Loading />}>
      <Show when={user()} fallback={<LoginView />}>
        {(u) => <ChatView user={u()} />}
      </Show>
    </Show>
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
