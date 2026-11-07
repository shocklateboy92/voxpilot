import ArrowLeft from "lucide-solid/icons/arrow-left";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import X from "lucide-solid/icons/x";
import {
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  Show,
  Suspense,
} from "solid-js";
import { ContentShell } from "../../app/ContentShell";
import { activeSessionId } from "../../app/navigation";
import { client, serverUrl } from "../../platform/connection";
import { configuredServer } from "../../platform/connection-config";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { IconButton } from "../../ui/IconButton";
import { MarkdownView } from "../../ui/MarkdownView";
import { Overlay } from "../../ui/Overlay";
import { Spinner } from "../../ui/Spinner";
import {
  clearFileRoute,
  clickedFileRequest,
  fileViewerUrl,
  resolveFileLink,
} from "./file-links";
import {
  type FileRequest,
  fileUrl,
  isMarkdownPath,
  markdownFile,
  setMarkdownFile,
} from "./file-state";

const NO_SWIPE = () => false;
const MAX_BYTES = 5 * 1024 * 1024;
const imageTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
};

export function MarkdownViewer() {
  return (
    <Show when={markdownFile()}>
      <OpenMarkdownViewer />
    </Show>
  );
}

function OpenMarkdownViewer() {
  const close = () => {
    const url = new URL(window.location.href);
    clearFileRoute(url);
    window.history.replaceState(null, "", url.href);
    setMarkdownFile(undefined);
  };
  const [history, setHistory] = createSignal<FileRequest[]>([]);
  let content: HTMLDivElement | undefined;
  let pane: HTMLDivElement | undefined;
  const [loaded, { refetch }] = createResource(
    markdownFile,
    async (request) => {
      try {
        if (!isMarkdownPath(request.path))
          throw new Error(
            "This viewer currently supports Markdown files only.",
          );
        const bytes = await client.file.read(request);
        if (bytes.byteLength > MAX_BYTES)
          throw new Error(
            "This Markdown file is too large to preview (maximum 5 MiB).",
          );
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (text.includes("\0"))
          throw new Error("This file contains binary data.");
        return { request, text };
      } catch (error) {
        // Loading failures stay inside the viewer, leaving navigation and refresh usable.
        return {
          request,
          error:
            error instanceof Error
              ? error.message
              : "Unable to load this file.",
        };
      }
    },
  );
  const fileLinkContext = () => {
    const request = loaded()?.request ?? markdownFile();
    if (!request) return undefined;
    return {
      request,
      sessionID: activeSessionId(),
      serverUrl,
      serverId: configuredServer?.id,
      appUrl: window.location.href,
    };
  };
  function resolveLink(href: string) {
    const context = fileLinkContext();
    return context
      ? resolveFileLink(href, context, { fragments: true })
      : undefined;
  }
  function navigateToFile(request: FileRequest) {
    const context = fileLinkContext();
    if (!context) return;
    window.history.replaceState(null, "", fileViewerUrl(request, context));
    setMarkdownFile(request);
  }

  createEffect(() => {
    const value = loaded();
    if (!value || !("text" in value) || !content) return;
    const element = content;
    const base = fileUrl(value.request);
    const controller = new AbortController();
    const objectUrls: string[] = [];
    pane?.scrollTo({ top: 0 });
    const fragment = value.request.fragment;
    if (fragment)
      element.querySelectorAll("[id]").forEach((heading) => {
        if (heading.id === fragment) heading.scrollIntoView({ block: "start" });
      });
    for (const image of element.querySelectorAll("img[src]")) {
      const src =
        image.getAttribute("data-file-source") ?? image.getAttribute("src");
      if (!src) continue;
      const source = src.startsWith("//")
        ? `${window.location.protocol}${src}`
        : src;
      if (!URL.canParse(source, base)) continue;
      const url = new URL(source, base);
      if (url.protocol !== "file:") continue; // Remote images load normally.
      image.setAttribute("data-file-source", url.href);
      image.removeAttribute("src");
      const path = decodeURIComponent(url.pathname);
      void client.file
        .read(
          { location: value.request.location, path },
          { signal: controller.signal },
        )
        .then((bytes) => {
          if (controller.signal.aborted) return;
          const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
          const blob = new Blob([new Uint8Array(bytes)], {
            type: imageTypes[extension] ?? "application/octet-stream",
          });
          const objectUrl = URL.createObjectURL(blob);
          objectUrls.push(objectUrl);
          image.setAttribute("src", objectUrl);
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            image.setAttribute(
              "title",
              error instanceof Error ? error.message : "Unable to load image",
            );
        });
    }
    onCleanup(() => {
      controller.abort();
      for (const url of objectUrls) URL.revokeObjectURL(url);
    });
  });

  function followLink(event: MouseEvent) {
    const next = clickedFileRequest(event, window.location.href, serverUrl);
    const request = loaded()?.request;
    if (!next || !request) return;
    event.preventDefault();
    const fragment = next.fragment;
    if (next.path === request.path) {
      navigateToFile(next);
      if (!fragment) pane?.scrollTo({ top: 0 });
      else
        content?.querySelectorAll("[id]").forEach((heading) => {
          if (heading.id === fragment)
            heading.scrollIntoView({ block: "start", behavior: "smooth" });
        });
      return;
    }
    setHistory((entries) => [...entries, request]);
    navigateToFile(next);
  }

  return (
    <Overlay label="Markdown viewer" position="fullscreen" onClose={close}>
      <ContentShell
        statusBarLeft={
          <span class="min-w-0 truncate" title={markdownFile()?.path}>
            {markdownFile()?.path}
          </span>
        }
        statusBarRight={
          <>
            <Show when={history().length > 0}>
              <IconButton
                variant="ghost"
                aria-label="Previous document"
                onClick={() => {
                  const previous = history().at(-1);
                  setHistory((entries) => entries.slice(0, -1));
                  if (previous) navigateToFile(previous);
                }}
              >
                <ArrowLeft size={18} />
              </IconButton>
            </Show>
            <IconButton
              variant="ghost"
              aria-label="Refresh file"
              disabled={loaded.loading}
              onClick={() => {
                void refetch();
              }}
            >
              <RefreshCw size={18} />
            </IconButton>
            <IconButton
              variant="ghost"
              aria-label="Close viewer"
              onClick={close}
            >
              <X size={18} />
            </IconButton>
          </>
        }
        canSwipeLeft={NO_SWIPE}
        canSwipeRight={NO_SWIPE}
        showComposer={false}
        onPaneMount={(element) => {
          pane = element;
        }}
        paneClass="min-h-0 flex-1 touch-pan-y overflow-x-clip overflow-y-auto scroll-pt-(--status-bar-clearance) px-[3vw] pt-(--status-bar-clearance) pb-[calc(var(--safe-bottom)+2rem)] text-left"
      >
        <Suspense fallback={<Spinner />}>
          <Show when={loaded()} keyed>
            {(value) => (
              <div class="mx-auto w-full max-w-[66rem] text-[0.9rem] wrap-break-word">
                <Show when={"error" in value ? value.error : undefined}>
                  {(message) => (
                    <div role="alert" class="p-4 text-error">
                      {message()}
                      <Button
                        class="mt-4 block"
                        onClick={() => {
                          void refetch();
                        }}
                      >
                        Retry
                      </Button>
                    </div>
                  )}
                </Show>
                <Show
                  when={"text" in value ? value.text : undefined}
                  fallback={
                    <Show when={"text" in value}>
                      <EmptyState>This file is empty.</EmptyState>
                    </Show>
                  }
                >
                  {(text) => (
                    <MarkdownView
                      text={text()}
                      resolveLink={resolveLink}
                      onMount={(element) => {
                        content = element;
                      }}
                      onClick={followLink}
                    />
                  )}
                </Show>
              </div>
            )}
          </Show>
        </Suspense>
      </ContentShell>
    </Overlay>
  );
}
