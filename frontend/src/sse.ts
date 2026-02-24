/**
 * OpenCode event stream subscription.
 */

import type { Event } from "@opencode-ai/sdk/client";
import { client } from "./api-client";

export type { Event };

export type EventCallback = (event: Event) => void;

let abortController: AbortController | null = null;

export async function subscribeToEvents(onEvent: EventCallback): Promise<void> {
  abortController = new AbortController();

  try {
    const result = await client.event.subscribe();
    for await (const event of result.stream) {
      if (abortController.signal.aborted) break;
      onEvent(event as Event);
    }
  } catch (err: unknown) {
    if (abortController?.signal.aborted) return;
    throw err;
  }
}

export function unsubscribeFromEvents(): void {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
}
