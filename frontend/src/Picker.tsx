/**
 * Picker page -- standalone entry point shown when the gateway serves
 * the frontend at "/" (no backend selected). Lists registered backends
 * and links to /backends/<name>/.
 *
 * This file is dynamically imported only in PICKER_MODE so it doesn't
 * pull in api-client / store / etc.
 */

import { createSignal, For, onCleanup, onMount, Show } from "solid-js";

type InstanceView = {
  name: string;
  version: string;
  online: boolean;
  has_wake: boolean;
  connected_at: string;
  last_seen: string;
};

type FetchState =
  | { kind: "loading" }
  | { kind: "ok"; instances: InstanceView[] }
  | { kind: "error"; message: string };

const REFRESH_INTERVAL = 5000;

export function Picker() {
  const [state, setState] = createSignal<FetchState>({ kind: "loading" });

  async function refresh() {
    try {
      const resp = await fetch("/api/gateway/instances", {
        cache: "no-store",
      });
      if (!resp.ok) {
        setState({
          kind: "error",
          message: `gateway returned HTTP ${resp.status}`,
        });
        return;
      }
      const instances = (await resp.json()) as InstanceView[];
      // Sort: online first, then alphabetical.
      instances.sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setState({ kind: "ok", instances });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  onMount(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), REFRESH_INTERVAL);
    onCleanup(() => window.clearInterval(id));
  });

  return (
    <div class="picker-root">
      <header class="picker-header">
        <h1>VoxPilot</h1>
        <p class="picker-subtitle">Choose a backend.</p>
      </header>
      <Show
        when={state().kind === "ok"}
        fallback={
          <Show
            when={state().kind === "error"}
            fallback={<p class="picker-status">Loading...</p>}
          >
            <p class="picker-status picker-error">
              Could not load backends: {(state() as { message: string }).message}
            </p>
          </Show>
        }
      >
        <PickerList state={state} />
      </Show>
    </div>
  );
}

function PickerList(props: { state: () => FetchState }) {
  const instances = () => {
    const s = props.state();
    return s.kind === "ok" ? s.instances : [];
  };
  return (
    <Show
      when={instances().length > 0}
      fallback={<p class="picker-status">No backends registered yet.</p>}
    >
      <ul class="picker-list">
        <For each={instances()}>{(inst) => <PickerRow inst={inst} />}</For>
      </ul>
    </Show>
  );
}

function PickerRow(props: { inst: InstanceView }) {
  const href = () => `/backends/${encodeURIComponent(props.inst.name)}/`;
  return (
    <li
      classList={{
        "picker-row": true,
        "picker-row-online": props.inst.online,
        "picker-row-offline": !props.inst.online,
      }}
    >
      <a class="picker-link" href={href()}>
        <span class="picker-name">{props.inst.name}</span>
        <span class="picker-meta">
          <span
            classList={{
              "picker-status-dot": true,
              online: props.inst.online,
            }}
            title={props.inst.online ? "online" : "offline"}
          />
          <span class="picker-version">{props.inst.version || "unknown"}</span>
        </span>
      </a>
    </li>
  );
}
