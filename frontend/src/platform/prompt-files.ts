import type { SessionPromptInput } from "@opencode/client";
import type { ReviewReference } from "@plugin/rpc";

export type PromptContent = Pick<SessionPromptInput, "text" | "files">;

/** Local browser draft; native URI encoding happens at the send boundary. */
export type PromptDraft = {
  text: PromptContent["text"];
  files: readonly File[];
};

export type ViewerContext =
  | ReviewReference
  | { filePath: string; workspace?: string };

export interface ViewerSelection {
  viewer: ViewerContext;
  text: string;
  side?: "before" | "after";
  truncated?: boolean;
}

function describeViewer(label: string, viewer: ViewerContext): string {
  const singleLine = (text: string) =>
    text.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
  const file = `${label}: ${singleLine(viewer.filePath)}`;
  if ("snapshotId" in viewer) return `${file}\nSnapshot: ${viewer.snapshotId}`;
  if (viewer.workspace)
    return `${file}\nWorkspace: ${singleLine(viewer.workspace)}`;
  return file;
}

function sameViewer(a: ViewerContext, b: ViewerContext): boolean {
  if (a.filePath !== b.filePath) return false;
  if ("snapshotId" in a)
    return "snapshotId" in b && a.snapshotId === b.snapshotId;
  return !("snapshotId" in b) && a.workspace === b.workspace;
}

export function formatViewerContext(
  viewer: ViewerContext | undefined,
  selection: ViewerSelection | undefined,
): string {
  const viewing = viewer && describeViewer("User was viewing", viewer);
  if (!selection) return viewing ?? "";
  const from =
    (!viewer || !sameViewer(viewer, selection.viewer)) &&
    describeViewer("Selected from", selection.viewer);
  const side = selection.side ? ` (${selection.side})` : "";
  const truncated = selection.truncated ? " [truncated]" : "";
  // Indent each line to keep the literal excerpt distinct from metadata.
  const excerpt = selection.text.replace(/^/gm, "  ");
  return [viewing, from, `Selected text${side}${truncated}:\n${excerpt}`]
    .filter(Boolean)
    .join("\n\n");
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error(`Could not read ${file.name}`));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.onabort = () =>
      reject(new Error(`Reading ${file.name} was cancelled`));
    reader.readAsDataURL(file);
  });
}

/** Object URLs are browser-local; send native inline data URIs instead. */
export async function preparePrompt(
  text: string,
  files: readonly File[],
): Promise<PromptContent> {
  const attachments: NonNullable<PromptContent["files"]>[number][] = [];
  // Read sequentially rather than multiplying peak memory use for large batches.
  for (const file of files)
    attachments.push({ uri: await readDataUrl(file), name: file.name });
  return {
    text: text.trim(),
    ...(attachments.length ? { files: attachments } : {}),
  };
}
