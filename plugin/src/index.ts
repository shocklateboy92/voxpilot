import { Plugin } from "@opencode/plugin";
import { z } from "zod";
import { errorMessage } from "./file-preview";
import { ComparisonInput, Snapshot, VoxPilotRpc } from "./rpc";
import { captureComparison } from "./services/comparison";
import { formatCodePreview } from "./services/format-code-preview";
import { formatAndDiff } from "./services/format-diff";
import { shouldInhibitIdle } from "./services/idle";
import { readFilePreview } from "./services/read-file-preview";
import { ReviewSourceInput, readReviewSource } from "./services/review-source";
import {
  createVocabularyReader,
  vocabularyInstructions,
  vocabularyPaths,
} from "./services/vocabulary";

export default Plugin.define({
  id: "voxpilot",
  async setup(ctx) {
    const vocabulary = createVocabularyReader(
      vocabularyPaths({
        checkout: ctx.location.project.directory,
        canonical: ctx.location.project.canonical,
        configHome: process.env.XDG_CONFIG_HOME,
        userFile: process.env.VOXPILOT_USER_VOCABULARY_FILE,
      }),
    );
    const instructions = vocabularyInstructions(vocabulary.paths);
    await ctx.session.hook("context", (event) => {
      event.system.push({ type: "text", text: instructions });
    });
    async function snapshot(id: string) {
      const stored = await ctx.storage.get(`snapshot/${id}`);
      return stored === undefined ? null : Snapshot.parse(stored);
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
      vocabulary: (_, context) => vocabulary.read(context.signal),
      compare: (input, context) => compare(input, context.signal),
      snapshot: ({ id }) => snapshot(id),
      readFilePreview: async ({ path, imageOnly }, { signal }) => {
        try {
          return await readFilePreview(path, { imageOnly }, signal);
        } catch (error) {
          signal.throwIfAborted();
          return { error: errorMessage(error, "Unable to read this file.") };
        }
      },
      formatCodePreview: (input, context) =>
        formatCodePreview(input, context.signal),
      formatComparison: async (
        { cacheId, filePath, printWidth, sourceLine },
        context,
      ) => {
        const entry = await snapshot(cacheId);
        const file = entry?.files.find((file) => file.filePath === filePath);
        if (!file)
          throw new Error("Review snapshot not found. Open a new comparison.");
        return formatAndDiff({
          before: file.beforeContent,
          after: file.afterContent,
          filePath,
          printWidth,
          sourceLine,
          signal: context.signal,
        });
      },
    });
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "voxpilot_read_review_source",
        options: { codemode: false },
        description:
          "Read original, unformatted source from one side of an immutable VoxPilot review snapshot. When a message's 'User was viewing' or 'Selected from' context includes a Snapshot, use that ID and file path instead of reading the current working tree. Line numbers are original source lines, starting at 1. Read before and after to see what changed. To cite a verified line in your reply, use a Markdown link like [the removed check](voxpilot-review:SNAPSHOT_UUID?file=src%2Fexample.ts&side=before&line=42). URL-encode the file path; use the before side for deleted code and the after side for current code. Use original source line numbers, never displayed diff line numbers.",
        input: z.toJSONSchema(ReviewSourceInput, { io: "input" }),
        execute: async (raw) => {
          const input = ReviewSourceInput.parse(raw);
          const entry = await snapshot(input.snapshotId);
          if (!entry) throw new Error("Review snapshot not found.");
          return { content: readReviewSource(entry, input) };
        },
      });
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
          if (shouldInhibitIdle(event, ctx.location.directory)) {
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
