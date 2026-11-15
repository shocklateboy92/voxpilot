import { render } from "solid-js/web";
import { createComposerKeyboard } from "../src/app/create-composer-keyboard";
import { MessageComposer } from "../src/features/chat/MessageComposer";

export function mount() {
  const main = document.querySelector("main");
  const output = document.querySelector("output");
  if (!main || !output) throw new Error("Missing fixture elements");
  return render(() => {
    const keyboard = createComposerKeyboard();
    return (
      <div
        class="app pb-[calc(var(--bottom-nav-height)+var(--safe-bottom))]"
        classList={{ "composer-keyboard-active": keyboard.active() }}
        onFocusIn={keyboard.onFocusIn}
        onFocusOut={keyboard.onFocusOut}
      >
        <MessageComposer
          onSend={async (draft) => {
            output.textContent = draft.text;
            return false;
          }}
        />
        <nav data-bottom-nav class="flex">
          Bottom navigation
        </nav>
      </div>
    );
  }, main);
}
