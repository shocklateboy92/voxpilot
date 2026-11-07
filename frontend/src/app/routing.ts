import {
  type NavigateOptions,
  useBeforeLeave,
  useLocation,
  useNavigate,
} from "@solidjs/router";
import { createEffect, createSignal, onCleanup } from "solid-js";
import {
  clearFileRoute,
  type FileLinkContext,
  fileRequestFromUrl,
  fileViewerUrl,
  resolveFileLink,
} from "../features/files/file-links";
import { fileUrl } from "../features/files/file-state";
import { serverUrl } from "../platform/connection";
import {
  configuredServer,
  normalizeServerUrl,
} from "../platform/connection-config";

interface NavigationState {
  viewerDepth?: number;
  returnToChat?: boolean;
  previousFile?: boolean;
}

// Existing session/SSE services run outside component context. Share the router's
// reactive location and navigator with them, not a second copy of URL state.
const [router, setRouter] = createSignal<{
  location: ReturnType<typeof useLocation<NavigationState>>;
  navigate: ReturnType<typeof useNavigate>;
}>();

export function useAppRouting(): void {
  const location = useLocation<NavigationState>();
  const navigate = useNavigate();
  setRouter({ location, navigate });
  onCleanup(() => setRouter(undefined));
  function changesConnection(url: URL): boolean {
    if (url.searchParams.has("connect")) return true;
    const targetServer = url.searchParams.get("server");
    if (!targetServer) return false;
    try {
      return (
        normalizeServerUrl(targetServer) !== serverUrl ||
        (configuredServer !== undefined &&
          url.searchParams.has("serverId") &&
          url.searchParams.get("serverId") !== configuredServer.id)
      );
    } catch {
      return false;
    }
  }
  useBeforeLeave((event) => {
    if (typeof event.to !== "string") return;
    const url = new URL(event.to, window.location.origin);
    // Backend/authentication changes need a fresh client, not soft navigation.
    if (changesConnection(url)) {
      event.preventDefault();
      window.location.assign(url.href);
    }
  });
  // Back/forward destinations are numeric in useBeforeLeave. Check the resulting
  // location too, so an old history entry cannot reuse another host's client.
  createEffect(() => {
    if (changesConnection(appUrl())) window.location.reload();
  });
}

export const appLocation = () => router()?.location;
export function appUrl(): URL {
  const location = appLocation();
  return location
    ? new URL(
        location.pathname + location.search + location.hash,
        window.location.origin,
      )
    : new URL(window.location.href);
}

export function navigateApp(
  to: string | number,
  options?: Partial<NavigateOptions>,
): void {
  const current = router();
  if (!current) throw new Error("Application router is unavailable");
  if (typeof to === "number") current.navigate(to);
  else {
    const url = new URL(to, window.location.origin);
    current.navigate(url.pathname + url.search + url.hash, {
      scroll: false,
      ...options,
    });
  }
}

export function currentFile() {
  const url = appUrl();
  return url.searchParams.get("server") === serverUrl
    ? fileRequestFromUrl(url)
    : undefined;
}

function viewerState(): NavigationState {
  const state = appLocation()?.state;
  const previousFile = currentFile() !== undefined;
  return {
    viewerDepth: previousFile ? (state?.viewerDepth ?? 0) + 1 : 1,
    returnToChat: !previousFile || state?.returnToChat === true,
    previousFile,
  };
}

/** Metadata lets Solid Router intercept native Markdown anchors and own history. */
export function resolveViewerLink(
  href: string,
  context: FileLinkContext,
  options?: { fragments?: boolean; fromChat?: boolean },
) {
  const url = resolveFileLink(href, context, options);
  if (!url) return undefined;
  return {
    href: url,
    attributes: {
      link: "",
      noscroll: "",
      state: JSON.stringify(
        options?.fromChat
          ? { viewerDepth: 1, returnToChat: true, previousFile: false }
          : viewerState(),
      ),
    },
  };
}

export function openMarkdown(path: string, directory: string): void {
  const request = { path, location: { directory } };
  const absolute = {
    ...request,
    path: decodeURIComponent(fileUrl(request).pathname),
  };
  const url = appUrl();
  navigateApp(
    fileViewerUrl(absolute, {
      request: absolute,
      sessionID: appLocation()?.hash.slice(1) || undefined,
      serverUrl,
      serverId: configuredServer?.id,
      appUrl: url.href,
    }),
    { state: viewerState() },
  );
}

export const hasPreviousFile = () =>
  appLocation()?.state?.previousFile === true;
export function closeFile(): void {
  const state = appLocation()?.state;
  if (state?.returnToChat && state.viewerDepth) {
    navigateApp(-state.viewerDepth);
    return;
  }
  // A copied URL has no in-app history to go back through.
  const url = appUrl();
  clearFileRoute(url);
  navigateApp(url.href, { replace: true });
}
