/** VoxPilot limits, not inferred provider limits. Keep encoded requests bounded. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_MESSAGE_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;
export const IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];
export const ATTACHMENT_ACCEPT = IMAGE_TYPES.join(",");

export function isPreviewableImage(mime: string): boolean {
  return IMAGE_TYPES.includes(mime);
}

export function attachmentError(
  file: File,
  existing: readonly File[],
): string | undefined {
  if (!isPreviewableImage(file.type))
    return `${file.name}: VoxPilot currently supports PNG, JPEG, WebP, and GIF images only.`;
  if (file.size === 0) return `${file.name}: this file is empty.`;
  if (file.size > MAX_FILE_BYTES)
    return `${file.name}: VoxPilot’s limit is 10 MiB per file.`;
  if (existing.length >= MAX_ATTACHMENTS)
    return `${file.name}: VoxPilot’s limit is 10 attachments per message.`;
  if (
    existing.reduce((total, entry) => total + entry.size, file.size) >
    MAX_MESSAGE_BYTES
  )
    return `${file.name}: VoxPilot’s total attachment limit is 20 MiB per message.`;
  return undefined;
}
