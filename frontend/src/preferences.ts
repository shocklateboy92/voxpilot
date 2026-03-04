/**
 * User preferences — persisted to localStorage.
 *
 * Extracted from store.ts so components and streaming.ts can read/write
 * the selected agent without importing the full store.
 */

import { createEffect, createSignal } from "solid-js";

const AGENT_STORAGE_KEY = "voxpilot-selected-agent";

/** Currently selected agent name (persisted to localStorage). */
export const [selectedAgent, setSelectedAgent] = createSignal<string>(
  localStorage.getItem(AGENT_STORAGE_KEY) ?? "build",
);

createEffect(() => {
  localStorage.setItem(AGENT_STORAGE_KEY, selectedAgent());
});
