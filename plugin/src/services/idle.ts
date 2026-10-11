import type { OpenCodeEvent } from "@opencode/client";

export function shouldInhibitIdle(event: OpenCodeEvent, directory: string) {
  if (!("location" in event) || event.location?.directory !== directory)
    return false;
  return (
    event.type === "session.step.ended" ||
    (event.type === "session.status" && event.data.status.type === "busy")
  );
}
