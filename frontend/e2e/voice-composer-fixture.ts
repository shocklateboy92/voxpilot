import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { MessageComposer } from "../src/features/chat/MessageComposer";

export function mount() {
  const main = document.querySelector("main");
  const output = document.querySelector("output");
  if (!main || !output) throw new Error("Missing fixture elements");
  const [sessionID, setSessionID] = createSignal("first");
  document.addEventListener("switch-session", () =>
    setSessionID(sessionID() === "first" ? "second" : "first"),
  );
  const dispose = render(
    () =>
      MessageComposer({
        get sessionID() {
          return sessionID();
        },
        onSend: async (draft) => {
          output.textContent = draft.text;
          return output.getAttribute("data-accept") === "true";
        },
      }),
    main,
  );
  document.addEventListener("dispose-composer", dispose, { once: true });
}
