import { createStore, reconcile } from "solid-js/store";
import type { Message } from "./api-client";
import { init } from "./init";
import type { AppState } from "./types";

export type {
  AppState,
  Message,
  Part,
  PendingPermission,
  Project,
  Session,
} from "./types";

const data = await init();
export const [store, setStore] = createStore<AppState>(data);

export function replaceMessages(messages: Message[]): void {
  setStore("messages", reconcile(messages));
}
