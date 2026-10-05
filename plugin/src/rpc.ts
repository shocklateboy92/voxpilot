/** Shared, browser-safe contract. All UI response types derive from this schema. */
import { Rpc } from "@opencode/plugin/rpc";
import { z } from "zod";

export const ComparisonInput = z.object({
  from: z.string().default("HEAD"),
  to: z.string().default("WORKTREE"),
  path: z.string().optional(),
  mode: z.enum(["refs", "branch", "committed"]).default("refs"),
  workdir: z.string().min(1),
});

export const Snapshot = z.object({
  id: z.string(),
  fromRef: z.string(),
  toRef: z.string(),
  resolvedFrom: z.string(),
  resolvedTo: z.string(),
  repoRoot: z.string(),
  createdAt: z.number(),
  files: z.array(
    z.object({
      filePath: z.string(),
      additions: z.number(),
      deletions: z.number(),
      beforeContent: z.string(),
      afterContent: z.string(),
    }),
  ),
});

export const VoxPilotRpc = Rpc.define({
  id: "voxpilot",
  events: {},
  methods: {
    config: {
      input: z.object({}),
      output: z.object({
        wakeUrl: z.string().nullable(),
        protocol: z.literal(1),
      }),
    },
    compare: { input: ComparisonInput, output: Snapshot },
    snapshot: {
      input: z.object({ id: z.string() }),
      output: Snapshot.nullable(),
    },
    formatComparison: {
      input: z.object({
        cacheId: z.string(),
        filePath: z.string(),
        printWidth: z.number().int().min(10).max(500),
      }),
      output: z.object({
        formattedBefore: z.string(),
        formattedAfter: z.string(),
        html: z.string(),
      }),
    },
  },
});
