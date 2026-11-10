import { isShellNotFoundError } from "@opencode/client";
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from "solid-js";
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
  // Session snapshots and tool metadata can change without changing the poll.
  // Compare the actual inputs before aborting an in-flight output request.
  const shellID = createMemo(input.shellID);
  const directory = createMemo(() => activeSession()?.location.directory);
  const open = createMemo(input.open);
  const running = createMemo(input.running);
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
    if (version !== generation || !untrack(open) || missing) return;

    await client.shell
      .output({ id, location: { directory }, cursor }, { signal })
      .then((response) => {
        if (version !== generation || currentID !== id) return;
        if (response.data.output) {
          setOutput((current) => `${current ?? ""}${response.data.output}`);
        }
        cursor = response.data.cursor;
        if (!untrack(open)) return;
        if (cursor < response.data.size) {
          schedule(request, 0);
          return;
        }
        if (untrack(running)) schedule(request, POLL_INTERVAL_MS);
      })
      .catch((error: unknown) => {
        if (version !== generation || currentID !== id) return;
        if (isShellNotFoundError(error)) {
          missing = true;
          setUnavailable(true);
          return;
        }
        console.error("Failed to read live shell output:", error);
        if (untrack(open) && untrack(running)) {
          schedule(request, POLL_INTERVAL_MS);
        }
      });
  };

  createEffect(() => {
    const id = shellID();
    const location = directory();
    const expanded = open();
    running();
    generation += 1;
    clearTimer();
    controller?.abort();
    if (id !== currentID || location !== currentDirectory) {
      currentID = id;
      currentDirectory = location;
      missing = false;
      cursor = 0;
      setOutput(undefined);
      setUnavailable(false);
    }
    if (!id || !location || !expanded || missing) return;
    controller = new AbortController();
    void poll({
      version: generation,
      id,
      directory: location,
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
