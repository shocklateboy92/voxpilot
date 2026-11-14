import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { moveNewComposerDraft } from "../src/features/chat/create-composer-draft";
import { MessageComposer } from "../src/features/chat/MessageComposer";
import { client } from "../src/platform/connection";
import { abortSpeechJobs } from "../src/platform/speech-lifecycle";
import { fetchVocabulary } from "../src/platform/vocabulary";

export function mount() {
  const main = document.querySelector("main");
  const output = document.querySelector("output");
  if (!main || !output) throw new Error("Missing fixture elements");
  const [sessionID, setSessionID] = createSignal<string | undefined>("first");
  const [directory, setDirectory] = createSignal("/fixture/original-project");
  const [streaming, setStreaming] = createSignal(false);
  document.addEventListener("start-streaming", () => setStreaming(true));
  document.addEventListener("stop-streaming", () => setStreaming(false));
  document.addEventListener("switch-session", () =>
    setSessionID(sessionID() === "first" ? "second" : "first"),
  );
  document.addEventListener("switch-backend", abortSpeechJobs);
  document.addEventListener("new-session", () => setSessionID(undefined));
  document.addEventListener("switch-project", () =>
    setDirectory("/fixture/other-project"),
  );
  const dispose = render(
    () =>
      MessageComposer({
        get sessionID() {
          return sessionID();
        },
        get voiceDirectory() {
          return directory();
        },
        get streaming() {
          return streaming();
        },
        readVoiceVocabulary: (directory, signal) =>
          fetchVocabulary(directory, client, signal),
        onSend: async (draft, target) => {
          if (
            target === undefined &&
            output.getAttribute("data-create-session") === "true"
          ) {
            moveNewComposerDraft("created");
            setSessionID("created");
          }
          output.textContent = draft.text;
          output.setAttribute("data-session", target ?? "new");
          output.setAttribute(
            "data-files",
            draft.files.map((file) => file.name).join(","),
          );
          output.setAttribute(
            "data-sends",
            String(Number(output.getAttribute("data-sends") ?? 0) + 1),
          );
          if (output.getAttribute("data-throw-send") === "true")
            throw new Error("Prompt admission failed");
          return output.getAttribute("data-accept") === "true";
        },
      }),
    main,
  );
  document.addEventListener("dispose-composer", dispose, { once: true });
}
