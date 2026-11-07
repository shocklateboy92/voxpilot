import { createEffect, onCleanup } from "solid-js";
import {
  clearFileRoute,
  fileRequestFromUrl,
} from "../features/files/file-links";
import { setMarkdownFile } from "../features/files/file-state";
import { serverUrl } from "../platform/connection";
import { activeSessionId } from "./navigation";

/** Restore copied file URLs after bootstrap and keep browser navigation in sync. */
export function useFileNavigation(): void {
  const sync = () => {
    const url = new URL(window.location.href);
    setMarkdownFile(
      url.searchParams.get("server") === serverUrl
        ? fileRequestFromUrl(url)
        : undefined,
    );
  };
  sync();
  window.addEventListener("popstate", sync);
  onCleanup(() => window.removeEventListener("popstate", sync));
  let previousSession = activeSessionId();
  createEffect(() => {
    const sessionID = activeSessionId();
    if (sessionID === previousSession) return;
    previousSession = sessionID;
    setMarkdownFile(undefined);
    const url = new URL(window.location.href);
    clearFileRoute(url);
    history.replaceState(null, "", url.href);
  });
}
