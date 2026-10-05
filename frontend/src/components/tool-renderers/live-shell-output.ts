import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";
import { client } from "../../api-client";
import { activeSession } from "../../navigation";

const POLL_INTERVAL_MS = 1_000;

export function createLiveShellOutput(input: {
  open: Accessor<boolean>;
  running: Accessor<boolean>;
  shellID: Accessor<string | undefined>;
}): Accessor<string | undefined> {
  const [output, setOutput] = createSignal<string>();
  let currentID: string | undefined;
  let cursor = 0;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };

  const schedule = (version: number, id: string, delay: number) => {
    clearTimer();
    timer = setTimeout(() => {
      timer = undefined;
      void poll(version, id);
    }, delay);
  };

  const poll = async (version: number, id: string): Promise<void> => {
    const directory = activeSession()?.location.directory;
    if (!directory || version !== generation || !input.open()) return;

    await client.shell
      .output({ id, location: { directory }, cursor })
      .then((response) => {
        if (version !== generation || currentID !== id) return;
        if (response.data.output) {
          setOutput((current) => `${current ?? ""}${response.data.output}`);
        }
        cursor = response.data.cursor;
        if (!input.open()) return;
        if (cursor < response.data.size) {
          schedule(version, id, 0);
          return;
        }
        if (input.running()) schedule(version, id, POLL_INTERVAL_MS);
      })
      .catch((error: unknown) => {
        if (version !== generation || currentID !== id) return;
        console.error("Failed to read live shell output:", error);
        if (input.open() && input.running()) {
          schedule(version, id, POLL_INTERVAL_MS);
        }
      });
  };

  createEffect(() => {
    const id = input.shellID();
    const open = input.open();
    input.running();
    generation += 1;
    clearTimer();
    if (id !== currentID) {
      currentID = id;
      cursor = 0;
      setOutput(undefined);
    }
    if (!id || !open) return;
    void poll(generation, id);
  });

  onCleanup(() => {
    generation += 1;
    clearTimer();
  });

  return output;
}
