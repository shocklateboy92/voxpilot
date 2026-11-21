/** Shared, browser-safe contract. All UI response types derive from this schema. */
import { Rpc } from "@opencode/plugin/rpc";
import { z } from "zod";
import { MAX_CODE_PREVIEW_LENGTH } from "./file-preview";
import { VocabularyTerm } from "./speech-contract";

export { VocabularyTerm } from "./speech-contract";

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

export const ReviewReference = z.object({
  snapshotId: z.uuid(),
  filePath: z.string().min(1),
});

export type ReviewReference = z.infer<typeof ReviewReference>;

export const ReviewLine = z.object({
  side: z.enum(["before", "after"]),
  line: z.number().int().positive(),
});

export const ReviewCitation = ReviewReference.extend(ReviewLine.shape);
export type ReviewCitation = z.infer<typeof ReviewCitation>;
export type ReviewLine = z.infer<typeof ReviewLine>;

const PrintWidth = z.number().int().min(10).max(500);

export const VOCABULARY_MAX_TERMS = 100;
export const VocabularyFile = z.array(VocabularyTerm).max(VOCABULARY_MAX_TERMS);

export const VocabularySource = z.object({
  path: z.string(),
  exists: z.boolean(),
  terms: VocabularyFile,
});
export const SpeechVocabulary = z.object({
  terms: z.array(VocabularyTerm).max(VOCABULARY_MAX_TERMS * 3),
  sources: z.object({
    user: VocabularySource,
    shared: VocabularySource,
    local: VocabularySource,
  }),
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
    vocabulary: { input: z.object({}).strict(), output: SpeechVocabulary },
    compare: { input: ComparisonInput, output: Snapshot },
    snapshot: {
      input: z.object({ id: z.string() }),
      output: Snapshot.nullable(),
    },
    readTextPreview: {
      input: z.object({ path: z.string().min(1) }),
      output: z.union([
        z.object({ text: z.string() }),
        z.object({ error: z.string() }),
      ]),
    },
    formatCodePreview: {
      input: z.object({
        filePath: z.string().min(1),
        text: z.string().max(MAX_CODE_PREVIEW_LENGTH),
        printWidth: PrintWidth,
        sourceLine: z.number().int().positive().optional(),
      }),
      output: z.object({ html: z.string(), targetFound: z.boolean() }),
    },
    formatComparison: {
      input: z.object({
        cacheId: z.uuid(),
        filePath: z.string(),
        printWidth: PrintWidth,
        sourceLine: ReviewLine.optional(),
      }),
      output: z.object({
        formattedBefore: z.string(),
        formattedAfter: z.string(),
        html: z.string(),
        targetRow: ReviewLine.optional(),
      }),
    },
  },
});
