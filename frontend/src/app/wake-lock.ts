import { createEffect, createMemo, createRoot, onCleanup } from "solid-js";
import { requestScreenWakeLock } from "../platform/wake-lock";
import { store } from "./store";

// The root lives for the document lifetime. Recording shares the same browser
// lock, so ending a response must not let the screen sleep during capture.
createRoot(() => {
  const anyBusy = createMemo(() =>
    Object.values(store.sessionStatuses).some((s) => s.type === "busy"),
  );
  createEffect(() => {
    if (anyBusy()) onCleanup(requestScreenWakeLock());
  });
});
