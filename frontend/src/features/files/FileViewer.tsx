import { errorMessage, isMarkdownPath } from "@plugin/file-preview";
import ArrowLeft from "lucide-solid/icons/arrow-left";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import X from "lucide-solid/icons/x";
import {
  createEffect,
  createResource,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from "solid-js";
import { ContentShell } from "../../app/ContentShell";
import { activeSessionId } from "../../app/navigation";
import {
  appLocation,
  appUrl,
  closeFile,
  currentFile,
  hasPreviousFile,
  navigateApp,
  resolveViewerLink,
} from "../../app/routing";
import { serverUrl } from "../../platform/connection";
import { configuredServer } from "../../platform/connection-config";
import { rpc } from "../../platform/rpc";
import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { IconButton } from "../../ui/IconButton";
import { MarkdownView } from "../../ui/MarkdownView";
import { Spinner } from "../../ui/Spinner";
import type { ReadingControls } from "../chat/reading-controls";
import { CodePreview } from "./CodePreview";
import { fileUrl } from "./file-state";
import { IMAGE_DECODE_ERROR, ImagePreview } from "./ImagePreview";
import { readEmbeddedImage, readImageBlob } from "./image-preview";

const NO_SWIPE = () => false;

interface FileViewerProps {
  composerHeight: number;
  readingControls: ReadingControls;
}

export function FileViewer(props: FileViewerProps) {
  return (
    <Show when={currentFile()}>
      <OpenFileViewer {...props} />
    </Show>
  );
}

function OpenFileViewer(props: FileViewerProps) {
  let region: HTMLElement | undefined;
  onMount(() => {
    const previous = document.activeElement;
    region?.focus();
    onCleanup(() =>
      queueMicrotask(() => {
        if (previous instanceof HTMLElement && previous.isConnected)
          previous.focus();
      }),
    );
  });
  let content: HTMLDivElement | undefined;
  let pane: HTMLDivElement | undefined;
  let pendingRead: AbortController | undefined;
  onCleanup(() => pendingRead?.abort());
  const isCurrent = (request: NonNullable<ReturnType<typeof currentFile>>) => {
    const active = currentFile();
    return (
      active?.path === request.path &&
      active.location?.directory === request.location?.directory
    );
  };
  const [loaded, { refetch }] = createResource(currentFile, async (request) => {
    pendingRead?.abort();
    const controller = new AbortController();
    pendingRead = controller;
    try {
      const result = await rpc.readFilePreview(
        { path: request.path },
        { signal: controller.signal },
      );
      if ("error" in result)
        return { kind: "error" as const, request, error: result.error };
      if ("image" in result) {
        const blob = await readImageBlob(
          request.path,
          result.image,
          controller.signal,
        );
        return { kind: "image" as const, request, blob };
      }
      return {
        kind: isMarkdownPath(request.path)
          ? ("markdown" as const)
          : ("code" as const),
        request,
        text: result.text,
      };
    } catch (error) {
      // Loading failures stay inside the viewer, leaving navigation and refresh usable.
      return {
        kind: "error" as const,
        request,
        error: errorMessage(error, "Unable to load this file."),
      };
    }
  });
  const viewerLabel = () => {
    const value = loaded.latest;
    if (value?.kind === "image" && isCurrent(value.request))
      return "Image viewer";
    return isMarkdownPath(currentFile()?.path ?? "")
      ? "Markdown viewer"
      : "Code viewer";
  };
  const fileLinkContext = () => {
    const request = loaded()?.request ?? currentFile();
    if (!request) return undefined;
    return {
      request,
      sessionID: activeSessionId(),
      serverUrl,
      serverId: configuredServer?.id,
      appUrl: appUrl().href,
    };
  };
  function resolveLink(href: string) {
    const context = fileLinkContext();
    return context
      ? resolveViewerLink(href, context, { fragments: true })
      : undefined;
  }

  createEffect(() => {
    // Link history metadata can re-render this body even at the same file URL.
    appLocation()?.state;
    const value = loaded();
    if (!value) return;
    pane?.scrollTo({ top: 0 });
    if (value.kind !== "markdown" || !content) return;
    const element = content;
    const base = fileUrl(value.request);
    const controller = new AbortController();
    const objectUrls: string[] = [];
    const fragment = value.request.fragment;
    if (fragment)
      element.querySelectorAll("[id]").forEach((heading) => {
        if (heading.id === fragment) heading.scrollIntoView({ block: "start" });
      });
    for (const image of element.querySelectorAll(
      "img[src], img[data-file-source]",
    )) {
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
      void readEmbeddedImage(path, controller.signal)
        .then((blob) => {
          if (controller.signal.aborted) return;
          const objectUrl = URL.createObjectURL(blob);
          objectUrls.push(objectUrl);
          image.addEventListener(
            "error",
            () => image.setAttribute("title", IMAGE_DECODE_ERROR),
            { once: true, signal: controller.signal },
          );
          image.removeAttribute("title");
          image.setAttribute("src", objectUrl);
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            image.setAttribute(
              "title",
              errorMessage(error, "Unable to load image"),
            );
        });
    }
    onCleanup(() => {
      controller.abort();
      for (const url of objectUrls) URL.revokeObjectURL(url);
    });
  });

  return (
    <section
      ref={region}
      tabIndex={-1}
      aria-label={viewerLabel()}
      class="absolute inset-0 flex flex-col bg-bg text-left outline-none [--status-bar-clearance:calc(4.5rem+var(--safe-top))]"
    >
      <ContentShell
        composerHeight={props.composerHeight}
        readingControls={props.readingControls}
        statusBarLeft={
          <span class="min-w-0 truncate" title={currentFile()?.path}>
            {currentFile()?.path}
          </span>
        }
        statusBarRight={null}
        statusBarActions={
          <>
            <IconButton
              variant="ghost"
              aria-label="Close viewer"
              onClick={closeFile}
            >
              <X size={14} />
            </IconButton>
            <Show when={hasPreviousFile()}>
              <IconButton
                variant="ghost"
                size="sm"
                aria-label="Previous document"
                onClick={() => navigateApp(-1)}
              >
                <ArrowLeft size={14} />
              </IconButton>
            </Show>
            <IconButton
              variant="ghost"
              size="sm"
              aria-label="Refresh file"
              disabled={loaded.loading}
              onClick={() => {
                void refetch();
              }}
            >
              <RefreshCw size={14} />
            </IconButton>
          </>
        }
        canSwipeLeft={NO_SWIPE}
        canSwipeRight={NO_SWIPE}
        onPaneMount={(element) => {
          pane = element;
        }}
        paneClass="markdown-pane min-h-0 flex-1 touch-pan-y overflow-x-clip overflow-y-auto scroll-pt-(--status-bar-clearance) pt-(--status-bar-clearance) text-left"
      >
        <Suspense fallback={<Spinner />}>
          <Show when={loaded()} keyed>
            {(value) => (
              <div class="text-[0.9rem] wrap-break-word">
                <Show when={value.kind === "image" && value}>
                  {(image) => (
                    <ImagePreview
                      blob={image().blob}
                      path={image().request.path}
                    />
                  )}
                </Show>
                <Show when={value.kind === "error" && value}>
                  {(failed) => (
                    <div role="alert" class="p-4 text-error">
                      {failed().error}
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
                  when={
                    (value.kind === "markdown" || value.kind === "code") &&
                    value
                  }
                >
                  {(file) => (
                    <Show
                      when={file().text}
                      fallback={<EmptyState>This file is empty.</EmptyState>}
                    >
                      {(text) => (
                        <div
                          classList={{ "px-3": file().kind === "markdown" }}
                          data-viewer-selection={
                            isCurrent(file().request) ? "file" : undefined
                          }
                        >
                          <Show
                            when={file().kind === "markdown"}
                            fallback={
                              <CodePreview
                                request={file().request}
                                text={text()}
                              />
                            }
                          >
                            <div class="mx-auto w-full max-w-[66rem] px-[3vw]">
                              <MarkdownView
                                text={text()}
                                resolveLink={resolveLink}
                                onMount={(element) => {
                                  content = element;
                                }}
                              />
                            </div>
                          </Show>
                        </div>
                      )}
                    </Show>
                  )}
                </Show>
              </div>
            )}
          </Show>
        </Suspense>
      </ContentShell>
    </section>
  );
}
