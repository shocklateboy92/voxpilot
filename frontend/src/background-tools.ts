import type {
  SessionMessageInfo,
  SessionMessageAssistantTool as ToolPart,
} from "@opencode/client";
import { store } from "./store";

type SyntheticMessage = Extract<SessionMessageInfo, { type: "synthetic" }>;

type BackgroundCompletion = {
  ids: string[];
  source: "shell" | "subagent";
  status: "completed" | "error";
};

function metadataString(
  metadata: SyntheticMessage["metadata"],
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

export function backgroundCompletion(
  message: SessionMessageInfo,
): BackgroundCompletion | undefined {
  if (message.type !== "synthetic") return undefined;
  const metadata = message.metadata;
  const source = metadataString(metadata, "source");
  const state = metadataString(metadata, "state");
  const failed =
    state === "error" ||
    state === "cancelled" ||
    state === "timeout" ||
    metadata?.timeout === true ||
    (typeof metadata?.exit === "number" && metadata.exit !== 0);

  if (source === "shell") {
    const ids = [
      metadataString(metadata, "shellID"),
      metadataString(metadata, "jobID"),
    ].filter((id): id is string => id !== undefined);
    if (ids.length === 0) return undefined;
    return { ids, source, status: failed ? "error" : "completed" };
  }

  if (source === "subagent") {
    const childID = metadataString(metadata, "childID");
    if (!childID) return undefined;
    return {
      ids: [childID],
      source,
      status: failed ? "error" : "completed",
    };
  }

  return undefined;
}

function partMetadata(part: ToolPart): Record<string, unknown> | undefined {
  return part.state.status === "streaming" ? undefined : part.state.metadata;
}

function partIDs(part: ToolPart): string[] {
  const metadata = partMetadata(part);
  if (part.name === "shell" || part.name === "bash") {
    const shellID = metadata?.shellID;
    return [part.id, ...(typeof shellID === "string" ? [shellID] : [])];
  }
  if (part.name === "subagent" || part.name === "task") {
    const sessionID = metadata?.sessionID ?? metadata?.sessionId;
    return [part.id, ...(typeof sessionID === "string" ? [sessionID] : [])];
  }
  return [];
}

export function backgroundToolStatus(
  part: ToolPart,
): "running" | "completed" | "error" | undefined {
  if (part.state.status !== "completed") return undefined;
  if (part.state.metadata?.status !== "running") return undefined;

  const ids = new Set(partIDs(part));
  for (let index = store.messages.length - 1; index >= 0; index -= 1) {
    const message = store.messages[index];
    if (!message) continue;
    const value = backgroundCompletion(message);
    if (!value) continue;
    const expectedSource =
      part.name === "shell" || part.name === "bash" ? "shell" : "subagent";
    if (
      value.source === expectedSource &&
      value.ids.some((id) => ids.has(id))
    ) {
      return value.status;
    }
  }
  return "running";
}
