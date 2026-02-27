import { z } from "zod/v4";

// POST /api/review/ref-diff
export const RefDiffRequest = z.object({
  fromRef: z.string(),
  toRef: z.string(),
  filePath: z.string(),
  printWidth: z.number(),
  repoRoot: z.string().optional(),
  cacheId: z.string().optional(),
});
