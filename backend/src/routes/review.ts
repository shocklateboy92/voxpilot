import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "../db";
import { getDiffCacheEntry } from "../mcp";
import { diffEntryFiles } from "../schema";
import { RefDiffRequest } from "../schemas/api";
import { formatAndDiff } from "../services/format-diff";
import { getFileAtRef } from "../services/git-utils";

export function createReviewRouter(workDir: string) {
  return new Hono()
    .get("/ref-diff/cache/:id", (c) => {
      const entry = getDiffCacheEntry(c.req.param("id"));
      if (!entry) {
        return c.json({ error: "Cache entry not found or expired" }, 404);
      }
      return c.json(entry);
    })
    .post("/ref-diff", zValidator("json", RefDiffRequest), async (c) => {
      const body = c.req.valid("json");

      let before: string;
      let after: string;

      if (body.cacheId) {
        // Try to load from database
        const db = getDb();
        const cached = db.query.diffEntryFiles
          .findFirst({
            where: and(
              eq(diffEntryFiles.entryId, body.cacheId),
              eq(diffEntryFiles.filePath, body.filePath),
            ),
          })
          .sync();

        if (cached) {
          before = cached.beforeContent;
          after = cached.afterContent;
        } else {
          // Fall back to live git
          const baseDir = body.repoRoot ?? workDir;
          before = await getFileAtRef(body.fromRef, body.filePath, baseDir);
          after = await getFileAtRef(body.toRef, body.filePath, baseDir);
        }
      } else {
        const baseDir = body.repoRoot ?? workDir;
        before = await getFileAtRef(body.fromRef, body.filePath, baseDir);
        after = await getFileAtRef(body.toRef, body.filePath, baseDir);
      }

      const result = await formatAndDiff({
        before,
        after,
        filePath: body.filePath,
        printWidth: body.printWidth,
      });

      return c.json(result);
    });
}
