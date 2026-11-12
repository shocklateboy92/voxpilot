import { createSignal, Show } from "solid-js";
import { switchConfiguredServer } from "../../platform/connection";
import {
  configuredServer,
  connectionConfig,
} from "../../platform/connection-config";
import { SegmentedControl } from "../../ui/SegmentedControl";

/** Switch backends in the former agent picker's slot without merging state. */
export function ServerPicker() {
  const [pendingId, setPendingId] = createSignal<string>();
  const pendingServer = () =>
    connectionConfig.servers.find((server) => server.id === pendingId());

  async function selectServer(id: string) {
    if (pendingId() || id === configuredServer?.id) return;
    setPendingId(id);
    try {
      await switchConfiguredServer(id);
    } finally {
      setPendingId(undefined);
    }
  }

  return (
    <Show when={configuredServer}>
      <SegmentedControl
        label="Server"
        options={connectionConfig.servers}
        value={configuredServer?.id ?? ""}
        optionValue={(server) => server.id}
        optionLabel={(server) => server.name}
        onChange={selectServer}
        disabled={Boolean(pendingId())}
      />
      <Show when={pendingServer()}>
        {(server) => (
          <span role="status" class="text-xs text-muted">
            Connecting to {server().name}…
          </span>
        )}
      </Show>
    </Show>
  );
}
