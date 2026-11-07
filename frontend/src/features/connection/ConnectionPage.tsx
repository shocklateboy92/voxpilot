import { createSignal, For, Show } from "solid-js";
import {
  makeClient,
  serverUrl,
  waitForPlugin,
} from "../../platform/connection";
import {
  configuredServer,
  connectionConfig,
  normalizeServerUrl,
  requestedServerUrl,
} from "../../platform/connection-config";
import { Button } from "../../ui/Button";
import { FormField } from "../../ui/FormField";
import { Select } from "../../ui/Select";
import { TextInput } from "../../ui/TextInput";
import { clearFileRoute } from "../files/file-links";

export function ConnectionPage() {
  const [url, setUrl] = createSignal(serverUrl);
  const [serverId, setServerId] = createSignal(
    configuredServer?.id ?? connectionConfig.servers[0]?.id ?? "",
  );
  const selectedServer = () =>
    connectionConfig.servers.find((server) => server.id === serverId());
  const [busy, setBusy] = createSignal(false);
  const [wakeSent, setWakeSent] = createSignal(false);
  const wakeUrl = () =>
    localStorage.getItem(
      `voxpilot:wakeUrl:${selectedServer()?.url ?? url().replace(/\/$/, "")}`,
    );

  async function wake() {
    const target = wakeUrl();
    if (!target) return;
    await fetch(target, { method: "POST", mode: "no-cors" });
    setWakeSent(true);
  }

  async function connect(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement))
      throw new Error("Connection form is unavailable");
    const data = new FormData(form);
    const selected = selectedServer();
    const submittedUrl = selected?.url ?? data.get("server");
    const submittedPassword = selected?.password ?? data.get("password");
    if (
      typeof submittedUrl !== "string" ||
      typeof submittedPassword !== "string"
    )
      throw new Error("Connection form is incomplete");
    const normalized = normalizeServerUrl(submittedUrl);
    setBusy(true);
    try {
      const remote = makeClient(normalized, submittedPassword);
      await remote.server.info({ signal: AbortSignal.timeout(10_000) });
      await waitForPlugin(remote);
      if (selected) {
        localStorage.setItem("voxpilot:serverId", selected.id);
        localStorage.removeItem("voxpilot:server");
        // Remove credentials left by the previous manual connection flow.
        for (const key of Object.keys(sessionStorage)) {
          if (key.startsWith("voxpilot:password:"))
            sessionStorage.removeItem(key);
        }
      } else {
        localStorage.removeItem("voxpilot:serverId");
        localStorage.setItem("voxpilot:server", normalized);
        sessionStorage.setItem(
          `voxpilot:password:${normalized}`,
          submittedPassword,
        );
      }
      const page = new URL(window.location.href);
      page.searchParams.delete("connect");
      if (page.searchParams.has("file") && normalized === requestedServerUrl) {
        page.searchParams.set("server", normalized);
        if (selected) page.searchParams.set("serverId", selected.id);
        else page.searchParams.delete("serverId");
      } else {
        clearFileRoute(page);
        page.searchParams.delete("server");
        page.searchParams.delete("serverId");
        page.hash = "";
      }
      // Replacing an unchanged URL with a session hash can be a same-document
      // navigation. Recreate the client after saving credentials in that case.
      if (page.href === window.location.href) window.location.reload();
      else window.location.replace(page.href);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main class="h-full overflow-y-auto p-6">
      <h1 class="mb-4 text-[2rem] font-bold tracking-tight">VoxPilot</h1>
      <p class="my-4 text-muted">
        Connect to an OpenCode server with the VoxPilot plugin.
      </p>
      <Show when={connectionConfig.error}>
        <p class="my-4 text-error" role="alert">
          {connectionConfig.error}
        </p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </Show>
      <Show when={!connectionConfig.error}>
        <form class="flex flex-col gap-3" onSubmit={connect}>
          <Show
            when={connectionConfig.servers.length > 0}
            fallback={
              <>
                <FormField label="Server URL">
                  {(attributes) => (
                    <TextInput
                      {...attributes}
                      name="server"
                      type="url"
                      required
                      value={url()}
                      onInput={(e) => setUrl(e.currentTarget.value)}
                      placeholder="https://opencode.example.com"
                    />
                  )}
                </FormField>
                <FormField label="Server password">
                  {(attributes) => (
                    <TextInput
                      {...attributes}
                      name="password"
                      type="password"
                      autocomplete="current-password"
                    />
                  )}
                </FormField>
                <p class="my-4 text-muted">
                  Leave the password blank for a paired same-origin server. A
                  password is kept only for this tab’s session.
                </p>
              </>
            }
          >
            <FormField label="Server">
              {(attributes) => (
                <Select
                  {...attributes}
                  value={serverId()}
                  onChange={(event) => setServerId(event.currentTarget.value)}
                >
                  <For each={connectionConfig.servers}>
                    {(server) => (
                      <option value={server.id}>{server.name}</option>
                    )}
                  </For>
                </Select>
              )}
            </FormField>
            <p class="text-muted">
              Access is provided by this site's server configuration.
            </p>
          </Show>
          <Button type="submit" disabled={busy()}>
            {busy() ? "Connecting…" : "Connect"}
          </Button>
        </form>
        <Show when={wakeUrl()}>
          <Button variant="ghost" onClick={wake}>
            {wakeSent() ? "Wake request sent" : "Wake host"}
          </Button>
        </Show>
      </Show>
    </main>
  );
}
