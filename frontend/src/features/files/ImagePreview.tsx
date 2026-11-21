import { createSignal, onCleanup, Show, untrack } from "solid-js";
import { Spinner } from "../../ui/Spinner";

export const IMAGE_DECODE_ERROR = "This browser couldn’t display the image.";

export function ImagePreview(props: { blob: Blob; path: string }) {
  // The viewer keys this component to each read, including refreshes.
  const url = URL.createObjectURL(untrack(() => props.blob));
  onCleanup(() => URL.revokeObjectURL(url));
  const [status, setStatus] = createSignal<"loading" | "ready" | "error">(
    "loading",
  );
  const name = () => props.path.split("/").at(-1) || "Image preview";
  return (
    <figure class="grid justify-items-center p-3">
      <Show when={status() === "loading"}>
        <Spinner />
      </Show>
      <Show
        when={status() !== "error"}
        fallback={
          <p role="alert" class="p-4 text-error">
            {IMAGE_DECODE_ERROR}
          </p>
        }
      >
        <img
          class="max-h-[max(6rem,calc(100dvh-var(--status-bar-clearance)-var(--composer-height,0px)-2rem))] max-w-full object-contain"
          classList={{ hidden: status() === "loading" }}
          src={url}
          alt={name()}
          onLoad={() => setStatus("ready")}
          onError={() => setStatus("error")}
        />
      </Show>
    </figure>
  );
}
