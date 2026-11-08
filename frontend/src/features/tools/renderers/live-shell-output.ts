import { isShellNotFoundError } from "@opencode/client";
import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";
import { activeSession } from "../../../app/navigation";
import { client } from "../../../platform/api-client";

const POLL_INTERVAL_MS = 1_000;

export function createLiveShellOutput(input: {
  open: Accessor<boolean>;
  running: Accessor<boolean>;
  shellID: Accessor<string | undefined>;
}) {
  const [output, setOutput] = createSignal<string>();
  const [unavailable, setUnavailable] = createSignal(false);
  let currentID: string | undefined;
  let currentDirectory: string | undefined;
  let missing = false;
  let cursor = 0;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;

  type Poll = {
    version: number;
    id: string;
    directory: string;
    signal: AbortSignal;
  };

  const clearTimer = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };

  const schedule = (request: Poll, delay: number) => {
    clearTimer();
    timer = setTimeout(() => {
      timer = undefined;
      void poll(request);
    }, delay);
  };

  const poll = async (request: Poll): Promise<void> => {
    const { version, id, directory, signal } = request;
    if (version !== generation || !input.open() || missing) return;

    await client.shell
      .output({ id, location: { directory }, cursor }, { signal })
      .then((response) => {
        if (version !== generation || currentID !== id) return;
        if (response.data.output) {
          setOutput((current) => `${current ?? ""}${response.data.output}`);
        }
        cursor = response.data.cursor;
        if (!input.open()) return;
        if (cursor < response.data.size) {
          schedule(request, 0);
          return;
        }
        if (input.running()) schedule(request, POLL_INTERVAL_MS);
      })
      .catch((error: unknown) => {
        if (version !== generation || currentID !== id) return;
        if (isShellNotFoundError(error)) {
          missing = true;
          setUnavailable(true);
          return;
        }
        console.error("Failed to read live shell output:", error);
        if (input.open() && input.running()) {
          schedule(request, POLL_INTERVAL_MS);
        }
      });
  };

  createEffect(() => {
    const id = input.shellID();
    const directory = activeSession()?.location.directory;
    const open = input.open();
    input.running();
    generation += 1;
    clearTimer();
    controller?.abort();
    if (id !== currentID || directory !== currentDirectory) {
      currentID = id;
      currentDirectory = directory;
      missing = false;
      cursor = 0;
      setOutput(undefined);
      setUnavailable(false);
    }
    if (!id || !directory || !open || missing) return;
    controller = new AbortController();
    void poll({
      version: generation,
      id,
      directory,
      signal: controller.signal,
    });
  });

  onCleanup(() => {
    generation += 1;
    clearTimer();
    controller?.abort();
  });

  return { output, unavailable };
}
