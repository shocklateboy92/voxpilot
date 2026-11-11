import type { SessionMessageUser } from "@opencode/client";
import File from "lucide-solid/icons/file";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { isPreviewableImage } from "./attachment-policy";
import { ImagePreview } from "./ImagePreview";

type SavedAttachment = NonNullable<SessionMessageUser["files"]>[number];

function attachmentBlob(file: SavedAttachment): Blob {
  const decoded = atob(file.data);
  const bytes = Uint8Array.from(decoded, (character) =>
    character.charCodeAt(0),
  );
  // Download-only files must stay inert even if the user opens their blob URL
  // in another tab instead of following the link's download attribute.
  return new Blob([bytes], {
    type: isPreviewableImage(file.mime)
      ? file.mime
      : "application/octet-stream",
  });
}

function MessageAttachment(props: { file: SavedAttachment }) {
  const [preview, setPreview] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const name = () => props.file.name || "Attachment";
  const image = () => isPreviewableImage(props.file.mime);
  const url = createMemo(() => {
    const value = URL.createObjectURL(attachmentBlob(props.file));
    onCleanup(() => URL.revokeObjectURL(value));
    return value;
  });
  return (
    <li class="min-w-0">
      <Show
        when={image() && !failed()}
        fallback={
          <a
            href={url()}
            download={name()}
            class="flex items-center gap-2 rounded-lg border border-border p-2 text-sm text-accent underline"
          >
            <File size={18} />
            <span class="min-w-0 break-all">{name()}</span>
          </a>
        }
      >
        <button
          type="button"
          class="block max-w-full overflow-hidden rounded-lg focus-visible:outline-2 focus-visible:outline-accent"
          aria-label={`View ${name()}`}
          onClick={() => setPreview(true)}
        >
          <img
            src={url()}
            alt={name()}
            loading="lazy"
            class="max-h-60 max-w-full object-contain"
            onError={() => setFailed(true)}
          />
        </button>
      </Show>
      <Show when={preview()}>
        <ImagePreview
          src={url()}
          name={name()}
          onClose={() => setPreview(false)}
        />
      </Show>
    </li>
  );
}

export function MessageAttachments(props: {
  files: NonNullable<SessionMessageUser["files"]>;
}) {
  return (
    <ul
      aria-label="Message attachments"
      class="flex min-w-0 flex-col gap-2 whitespace-normal"
    >
      <For each={props.files}>
        {(file) => <MessageAttachment file={file} />}
      </For>
    </ul>
  );
}
