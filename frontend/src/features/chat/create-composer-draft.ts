import { batch, createSignal } from "solid-js";
import { attachmentError } from "./attachments/attachment-policy";

export interface DraftAttachment {
  id: string;
  file: File;
  previewUrl: string;
}

function createComposerDraft() {
  const [text, updateText] = createSignal("");
  const [attachments, setAttachments] = createSignal<DraftAttachment[]>([]);
  const [errors, setErrors] = createSignal<string[]>([]);
  const [sending, setSending] = createSignal(false);
  let textRevision = 0;
  // IDs are draft-local and never sent to the server. Avoid secure-context-only
  // APIs such as crypto.randomUUID(), since LAN development also uses HTTP.
  let nextAttachmentID = 0;

  function setText(value: string) {
    textRevision += 1;
    updateText(value);
  }

  function addFiles(files: readonly File[]) {
    if (sending()) return;
    const next = [...attachments()];
    const rejected: string[] = [];
    for (const file of files) {
      const error = attachmentError(
        file,
        next.map((entry) => entry.file),
      );
      if (error) {
        rejected.push(error);
        continue;
      }
      next.push({
        id: String(nextAttachmentID++),
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }
    batch(() => {
      setAttachments(next);
      setErrors(rejected);
    });
  }

  function removeAttachment(id: string) {
    const removed = attachments().find((entry) => entry.id === id);
    if (removed) URL.revokeObjectURL(removed.previewUrl);
    setAttachments((entries) => entries.filter((entry) => entry.id !== id));
    setErrors([]);
  }

  function snapshot() {
    return { text: text(), textRevision, attachments: [...attachments()] };
  }

  function consume(submitted: ReturnType<typeof snapshot>) {
    batch(() => {
      if (submitted.textRevision === textRevision) setText("");
      for (const entry of submitted.attachments) removeAttachment(entry.id);
    });
  }

  function dispose() {
    for (const entry of attachments()) URL.revokeObjectURL(entry.previewUrl);
    setAttachments([]);
  }

  return {
    text,
    setText,
    attachments,
    errors,
    sending,
    setSending,
    addFiles,
    removeAttachment,
    snapshot,
    consume,
    dispose,
  };
}

export type ComposerDraft = ReturnType<typeof createComposerDraft>;

// Drafts outlive composer mounts and are isolated by session. Browser Files stay
// in memory only; never serialize them or their object URLs into localStorage.
const drafts = new Map<string | undefined, ComposerDraft>();

export function composerDraft(sessionID: string | undefined): ComposerDraft {
  const existing = drafts.get(sessionID);
  if (existing) return existing;
  const draft = createComposerDraft();
  drafts.set(sessionID, draft);
  return draft;
}

/** Preserve ownership across the new-chat → created-session navigation. */
export function moveNewComposerDraft(sessionID: string) {
  const draft = composerDraft(undefined);
  drafts.set(sessionID, draft);
  drafts.delete(undefined);
}

export function discardComposerDraft(sessionID: string) {
  drafts.get(sessionID)?.dispose();
  drafts.delete(sessionID);
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const draft of drafts.values()) draft.dispose();
    drafts.clear();
  });
}
