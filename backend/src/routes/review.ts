import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { Hono } from "hono";
import { buildDiffArgs, getDiffCacheEntry } from "../mcp";
import { formatAndDiff } from "../services/format-diff";
import { runGit } from "../services/git-utils";

export function createReviewRouter(client: OpencodeClient, workDir: string) {
  const router = new Hono();

  // POST /api/review/format-diff — session-based diff (existing)
  router.post("/format-diff", async (c) => {
    const body = (await c.req.json()) as {
      sessionId: string;
      filePath: string;
      printWidth: number;
    };

    if (
      !body.sessionId ||
      !body.filePath ||
      typeof body.printWidth !== "number"
    ) {
      return c.json(
        { error: "Missing required fields: sessionId, filePath, printWidth" },
        400,
      );
    }

    const diffResult = await client.session.diff({
      sessionID: body.sessionId,
    });
    const fileDiff = (diffResult.data ?? []).find(
      (d) => d.file === body.filePath,
    );

    if (!fileDiff) {
      return c.json(
        { error: `File not found in session diff: ${body.filePath}` },
        404,
      );
    }

    const result = await formatAndDiff({
      before: fileDiff.before ?? "",
      after: fileDiff.after ?? "",
      filePath: body.filePath,
      printWidth: body.printWidth,
    });

    return c.json(result);
  });

  // GET /api/review/ref-diff/cache/:id — fetch cached diff metadata
  router.get("/ref-diff/cache/:id", (c) => {
    const entry = getDiffCacheEntry(c.req.param("id"));
    if (!entry) {
      return c.json({ error: "Cache entry not found or expired" }, 404);
    }
    return c.json(entry);
  });

  // GET /api/review/ref-diff/files — list changed files between two refs
  router.get("/ref-diff/files", async (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    const path = c.req.query("path");

    if (!from || !to) {
      return c.json({ error: "Missing required query params: from, to" }, 400);
    }

    const built = buildDiffArgs(from, to);
    if ("error" in built) {
      return c.json({ error: built.error }, 400);
    }

    const args = [...built.args, "--numstat"];
    if (path) args.push("--", path);

    const result = await runGit(args, workDir);
    if (result.exitCode !== 0) {
      return c.json({ error: `git diff failed: ${result.stderr.trim()}` }, 500);
    }

    const files = result.stdout
      .trim()
      .split("\n")
      .filter((line) => line.includes("\t"))
      .map((line) => {
        const [add, del, file] = line.split("\t");
        return {
          file: file!,
          additions: Number.parseInt(add!, 10) || 0,
          deletions: Number.parseInt(del!, 10) || 0,
        };
      });

    return c.json({ from, to, files });
  });

  // POST /api/review/ref-diff — formatted diff for a single file
  router.post("/ref-diff", async (c) => {
    const body = (await c.req.json()) as {
      from: string;
      to: string;
      filePath: string;
      printWidth: number;
      repoRoot?: string;
    };

    if (
      !body.from ||
      !body.to ||
      !body.filePath ||
      typeof body.printWidth !== "number"
    ) {
      return c.json(
        { error: "Missing required fields: from, to, filePath, printWidth" },
        400,
      );
    }

    const baseDir = body.repoRoot ?? workDir;
    const before = await getFileAtRef(body.from, body.filePath, baseDir);
    const after = await getFileAtRef(body.to, body.filePath, baseDir);

    const result = await formatAndDiff({
      before,
      after,
      filePath: body.filePath,
      printWidth: body.printWidth,
    });

    return c.json(result);
  });

  return router;
}

/**
 * Get file content at a specific git ref.
 *
 * Handles the synthetic refs INDEX and WORKTREE, plus any real git ref.
 */
async function getFileAtRef(
  ref: string,
  filePath: string,
  workDir: string,
): Promise<string> {
  if (ref === "WORKTREE") {
    try {
      const file = Bun.file(`${workDir}/${filePath}`);
      return await file.text();
    } catch {
      return "";
    }
  }

  if (ref === "INDEX") {
    const result = await runGit(["show", `:${filePath}`], workDir);
    return result.exitCode === 0 ? result.stdout : "";
  }

  // Real git ref — use git show
  const result = await runGit(["show", `${ref}:${filePath}`], workDir);
  return result.exitCode === 0 ? result.stdout : "";
}
