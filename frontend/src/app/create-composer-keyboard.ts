import { createEffect, createSignal } from "solid-js";
import { composerMode } from "../features/chat/preferences";

/** Track focus explicitly: WebKit can retain :has(:focus) styles after navigation
 * or removing the focused textarea. Voice mode must never hide navigation. */
export function createComposerKeyboard() {
  const [focused, setFocused] = createSignal(false);

  createEffect(() => {
    if (composerMode() !== "text") setFocused(false);
  });

  return {
    active: () => composerMode() === "text" && focused(),
    onFocusIn: (event: FocusEvent) => {
      setFocused(
        event.target instanceof HTMLTextAreaElement &&
          event.target.hasAttribute("data-composer-input"),
      );
    },
    onFocusOut: () => setFocused(false),
  };
}
