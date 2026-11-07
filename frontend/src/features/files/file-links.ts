import { type FileRequest, fileUrl } from "./file-state";

/** File paths belong to the owning session/document, never the frontend origin. */
export interface FileLinkContext {
  request: FileRequest;
  sessionID?: string;
  serverUrl: string;
  serverId?: string;
  appUrl: string;
}

const FILE_PARAMS = ["file", "directory", "fragment"];

export function clearFileRoute(url: URL): void {
  for (const name of FILE_PARAMS) url.searchParams.delete(name);
}

export function fileViewerUrl(
  request: FileRequest,
  context: FileLinkContext,
): string {
  const url = new URL(context.appUrl);
  url.search = "";
  url.hash = context.sessionID ?? "";
  url.searchParams.set("server", context.serverUrl);
  if (context.serverId) url.searchParams.set("serverId", context.serverId);
  url.searchParams.set("directory", request.location?.directory ?? "/");
  url.searchParams.set("file", request.path);
  if (request.fragment) url.searchParams.set("fragment", request.fragment);
  return url.href;
}

export function fileRequestFromUrl(url: URL): FileRequest | undefined {
  const path = url.searchParams.get("file");
  const directory = url.searchParams.get("directory");
  if (!path?.startsWith("/") || !directory?.startsWith("/")) return undefined;
  return {
    path,
    location: { directory },
    fragment: url.searchParams.get("fragment") ?? undefined,
  };
}

/** Schemed URLs and site-root web paths remain ordinary browser links. */
export function resolveFileLink(
  href: string,
  context: FileLinkContext,
  options: { fragments?: boolean } = {},
): string | undefined {
  if (
    !href ||
    (href.startsWith("#") && !options.fragments) ||
    href.startsWith("?") ||
    href.startsWith("//") ||
    /^[a-z][a-z\d+.-]*:/i.test(href)
  )
    return undefined;
  // A leading slash with no extension is more likely a web route than a file.
  if (href.startsWith("/") && !/\/[^/?#]+\.[^/?#]+(?:[?#]|$)/.test(href))
    return undefined;
  const base = fileUrl(context.request);
  if (!URL.canParse(href, base)) return undefined;
  const target = new URL(href, base);
  if (target.protocol !== "file:" || target.host) return undefined;
  try {
    const request = {
      location: context.request.location,
      path: decodeURIComponent(target.pathname),
      fragment: decodeURIComponent(target.hash.slice(1)) || undefined,
    };
    return fileViewerUrl(request, context);
  } catch {
    // Invalid percent escapes are not file references; leave them untouched.
    return undefined;
  }
}

export function clickedFileRequest(
  event: MouseEvent,
  appUrl: string,
  serverUrl: string,
): FileRequest | undefined {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey
  )
    return undefined;
  const target = event.target;
  if (!(target instanceof Element)) return undefined;
  const link = target.closest("a[href]");
  if (
    link?.getAttribute("target") === "_blank" ||
    link?.hasAttribute("download")
  )
    return undefined;
  const href = link?.getAttribute("href");
  if (!href || !URL.canParse(href, appUrl)) return undefined;
  const url = new URL(href, appUrl);
  const current = new URL(appUrl);
  if (
    url.origin !== current.origin ||
    url.hash !== current.hash ||
    url.searchParams.get("server") !== serverUrl
  )
    return undefined;
  return fileRequestFromUrl(url);
}
