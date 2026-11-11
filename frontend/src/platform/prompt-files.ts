import type { SessionPromptInput } from "@opencode/client";

export type PromptContent = Pick<SessionPromptInput, "text" | "files">;

/** Local browser draft; native URI encoding happens at the send boundary. */
export type PromptDraft = {
  text: PromptContent["text"];
  files: readonly File[];
};

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
