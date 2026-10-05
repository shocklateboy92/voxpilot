import { Plugin } from "@opencode/plugin";
import { ComparisonInput, Snapshot, VoxPilotRpc } from "./rpc";
import { captureComparison } from "./services/comparison";
import { formatAndDiff } from "./services/format-diff";
import { legacySnapshot } from "./services/legacy-snapshot";

export default Plugin.define({
  id: "voxpilot",
  async setup(ctx) {
    async function snapshot(id: string) {
      const stored = await ctx.storage.get(`snapshot/${id}`);
      if (stored !== undefined) return Snapshot.parse(stored);
      const legacy = legacySnapshot(id);
      if (legacy) await ctx.storage.set(`snapshot/${id}`, legacy);
      return legacy;
    }
    async function compare(
      input: Parameters<typeof captureComparison>[0],
      signal?: AbortSignal,
    ) {
      const result = await captureComparison(input, signal);
      await ctx.storage.set(`snapshot/${result.id}`, result);
      return result;
    }
    await ctx.rpc.register(VoxPilotRpc, {
      config: async () => ({
        wakeUrl: process.env.VOXPILOT_WAKE_URL ?? null,
        protocol: 1 as const,
      }),
      compare: (input, context) => compare(input, context.signal),
      snapshot: ({ id }) => snapshot(id),
      formatComparison: async ({ cacheId, filePath, printWidth }, context) => {
        const entry = await snapshot(cacheId);
        const file = entry?.files.find((file) => file.filePath === filePath);
        if (!file)
          throw new Error("Review snapshot not found. Open a new comparison.");
        return formatAndDiff({
          before: file.beforeContent,
          after: file.afterContent,
          filePath,
          printWidth,
          signal: context.signal,
        });
      },
    });
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "voxpilot_show_diff",
        options: { codemode: false },
        description:
          "Show a width-formatted comparison in VoxPilot. Returns a stat summary and review reference; the UI displays the full code. Compare Git refs, INDEX or WORKTREE. Defaults: HEAD to WORKTREE. workdir must be absolute.",
        input: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            path: { type: "string" },
            workdir: { type: "string" },
          },
          required: ["workdir"],
          additionalProperties: false,
        },
        execute: async (raw, context) => {
          const result = await compare(
            ComparisonInput.parse(raw),
            context.signal,
          );
          const stats = result.files
            .map((f) => `${f.filePath}: +${f.additions} -${f.deletions}`)
            .join("\n");
          return {
            content: `Diff ${result.fromRef} → ${result.toRef}\n${stats || "No changes"}\n[ref:${result.id}]`,
          };
        },
      });
    });
    // Plugin instances are location-scoped: only react to this location's events.
    const controller = new AbortController();
    if (process.env.DBUS_SESSION_BUS_ADDRESS) {
      void (async () => {
        for await (const event of ctx.event.subscribe({
          signal: controller.signal,
        })) {
          if (
            !("location" in event) ||
            event.location?.directory !== ctx.location.directory
          )
            continue;
          if (
            event.type === "session.step.ended" ||
            (event.type === "session.status" &&
              event.data.status.type === "busy")
          ) {
            const proc = Bun.spawn(
              [
                "dbus-send",
                "--session",
                "--dest=org.freedesktop.ScreenSaver",
                "/ScreenSaver",
                "org.freedesktop.ScreenSaver.SimulateUserActivity",
              ],
              { stdout: "ignore", stderr: "ignore" },
            );
            await proc.exited;
          }
        }
      })().catch((error: unknown) => {
        if (!controller.signal.aborted)
          console.error("[voxpilot] idle inhibition stopped", error);
      });
    }
    return () => controller.abort();
  },
});
