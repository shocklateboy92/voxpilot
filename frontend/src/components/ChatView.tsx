/**
 * Main chat view — chat area + bottom nav with session picker.
 */

import { onMount } from "solid-js";
import type { GitHubUser } from "../store";
import { logout } from "../api-client";
import { initSessions } from "../sessions";
import { ChatMain } from "./ChatMain";
import { BottomNav } from "./BottomNav";
import { SessionPicker } from "./SessionPicker";

interface Props {
  user: GitHubUser;
}

export function ChatView(props: Props) {
  onMount(() => {
    void initSessions();
  });

  return (
    <main id="app">
      <div id="user-info">
        <img id="user-avatar" src={props.user.avatar_url} alt="avatar" />
        <span id="user-name">{props.user.name ?? props.user.login}</span>
        <button class="btn btn-small" onClick={() => void logout()}>
          Sign out
        </button>
      </div>
      <ChatMain />
      <BottomNav />
      <SessionPicker />
    </main>
  );
}
