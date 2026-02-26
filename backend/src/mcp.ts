/**
 * VoxPilot MCP server — exposes tools to the OpenCode agent.
 *
 * Currently provides:
 *   - show_diff: Show a diff between two git refs in the VoxPilot diff viewer.
 *
 * Mounted as a Streamable HTTP endpoint on the Hono app at /mcp.
 * Uses stateful sessions (one McpServer+transport per client session).
 *
 * Tool results that need structured data for the frontend are cached
 * server-side keyed by a generated ID. The LLM receives only a human-
 * readable summary plus the cache ID; the frontend fetches the full
 * payload via /api/review/ref-diff/cache/:id.
 */

import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";
import { z } from "zod/v4";
import { ensureGitRepo, runGit } from "./services/git-utils";

// ── Diff cache ──────────────────────────────────────────────────

/** Cached result from a show_diff tool call. */
export interface DiffCacheEntry {
  from: string;
  to: string;
  resolvedFrom: string;
  resolvedTo: string;
  repoRoot: string;
  path?: string;
  files: { file: string; additions: number; deletions: number }[];
  createdAt: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const diffCache = new Map<string, DiffCacheEntry>();

export function getDiffCacheEntry(id: string): DiffCacheEntry | undefined {
  const entry = diffCache.get(id);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    diffCache.delete(id);
    return undefined;
  }
  return entry;
}

/** Periodically evict expired entries. */
setInterval(
  () => {
    const now = Date.now();
    for (const [id, entry] of diffCache) {
      if (now - entry.createdAt > CACHE_TTL_MS) {
        diffCache.delete(id);
      }
    }
  },
  5 * 60 * 1000,
);

// ── Ref validation & diff args ──────────────────────────────────

/**
 * Valid characters for a git ref: alphanumeric, `/`, `.`, `_`, `-`, `~`, `^`, `{`, `}`, `@`.
 * Rejects anything that could be a shell metacharacter or flag injection.
 */
const SAFE_REF_PATTERN = /^[a-zA-Z0-9/_.\-~^{}@]+$/;

/** Synthetic refs that are NOT real git refs. */
const SYNTHETIC_REFS = new Set(["INDEX", "WORKTREE"]);

function validateRef(ref: string): string | null {
  if (
    !SYNTHETIC_REFS.has(ref) &&
    (ref.startsWith("-") || !SAFE_REF_PATTERN.test(ref))
  ) {
    return `Invalid ref '${ref}'. Use a git ref (HEAD, branch, SHA, etc.), INDEX, or WORKTREE.`;
  }
  return null;
}

/**
 * Build the correct `git diff` argument list for a from→to combination.
 *
 * Supports all combinations of real git refs plus the synthetic
 * INDEX and WORKTREE refs.
 */
export function buildDiffArgs(
  from: string,
  to: string,
): { args: string[] } | { error: string } {
  const base: string[] = ["diff"];

  if (from === "INDEX" && to === "WORKTREE") {
    // git diff (index vs worktree)
  } else if (from === "HEAD" && to === "INDEX") {
    base.push("--staged");
  } else if (from === "INDEX" && to !== "WORKTREE") {
    base.push("--staged", to);
  } else if (from !== "INDEX" && from !== "WORKTREE" && to === "WORKTREE") {
    base.push(from);
  } else if (from !== "INDEX" && from !== "WORKTREE" && to === "INDEX") {
    base.push("--staged", from);
  } else if (!SYNTHETIC_REFS.has(from) && !SYNTHETIC_REFS.has(to)) {
    base.push(from, to);
  } else {
    return { error: `Unsupported diff combination from=${from} to=${to}.` };
  }

  return { args: base };
}

/**
 * Resolve a ref to a commit SHA. Returns the ref unchanged for
 * synthetic refs (INDEX, WORKTREE) which can't be pinned.
 */
async function resolveRef(ref: string, workDir: string): Promise<string> {
  if (SYNTHETIC_REFS.has(ref)) return ref;
  const result = await runGit(["rev-parse", ref], workDir);
  if (result.exitCode !== 0) return ref;
  return result.stdout.trim();
}

// ── MCP server factory ──────────────────────────────────────────

function createMcpServer(workDir: string) {
  const server = new McpServer({
    name: "voxpilot",
    version: "0.1.0",
  });

  server.registerTool(
    "show_diff",
    {
      title: "Show Diff",
      description:
        "Show a diff between two states of the git repository in the VoxPilot visual diff viewer. " +
        "The full formatted diff (with actual code changes) is automatically displayed to the user, " +
        "so you do NOT need to repeat the code or offer to show file contents. " +
        "You only receive a stat summary; use it to discuss the changes at a high level. " +
        "Use `from` and `to` to specify what to compare. " +
        "Special refs: INDEX (staging area), WORKTREE (working directory). " +
        "Common patterns: " +
        "from=HEAD to=WORKTREE (uncommitted changes), " +
        "from=HEAD to=INDEX (staged changes), " +
        "from=INDEX to=WORKTREE (unstaged changes), " +
        "from=HEAD~1 to=HEAD (last commit's changes), " +
        "from=<sha> to=<sha> (compare two commits). " +
        "Defaults: from=HEAD, to=WORKTREE.",
      inputSchema: {
        from: z
          .string()
          .optional()
          .describe(
            "The base state to compare from. " +
              "A git ref (HEAD, branch, tag, SHA, HEAD~2), INDEX (staging area), or WORKTREE (working directory). " +
              "Defaults to HEAD.",
          ),
        to: z
          .string()
          .optional()
          .describe(
            "The target state to compare to. " +
              "A git ref, INDEX, or WORKTREE. " +
              "Defaults to WORKTREE.",
          ),
        path: z
          .string()
          .optional()
          .describe(
            "Restrict diff to a specific file or directory (relative to repo root). " +
              "Omit to show all changes.",
          ),
      },
    },
    async ({ from, to, path }) => {
      const fromRef = from ?? "HEAD";
      const toRef = to ?? "WORKTREE";

      // Validate refs
      for (const ref of [fromRef, toRef]) {
        const err = validateRef(ref);
        if (err) {
          return {
            content: [{ type: "text" as const, text: `Error: ${err}` }],
          };
        }
      }

      if (fromRef === toRef) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: 'from' and 'to' must be different.",
            },
          ],
        };
      }

      // Ensure we're in a git repo
      const repoCheck = await ensureGitRepo(workDir);
      if ("error" in repoCheck) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${repoCheck.error}` },
          ],
        };
      }

      // Build diff args
      const built = buildDiffArgs(fromRef, toRef);
      if ("error" in built) {
        return {
          content: [{ type: "text" as const, text: `Error: ${built.error}` }],
        };
      }

      // Get stat summary (this is what the LLM sees)
      const statArgs = [...built.args, "--stat"];
      if (path) statArgs.push("--", path);

      const statResult = await runGit(statArgs, workDir);
      if (statResult.exitCode !== 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: git diff failed: ${statResult.stderr.trim()}`,
            },
          ],
        };
      }

      const statOutput = statResult.stdout.trim();

      if (!statOutput) {
        const suffix = path ? ` in '${path}'` : "";
        return {
          content: [
            {
              type: "text" as const,
              text: `No changes found between ${fromRef} and ${toRef}${suffix}.`,
            },
          ],
        };
      }

      // Get numstat for structured file list
      const numstatArgs = [...built.args, "--numstat"];
      if (path) numstatArgs.push("--", path);

      const numstatResult = await runGit(numstatArgs, workDir);
      const files =
        numstatResult.exitCode === 0
          ? numstatResult.stdout
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
              })
          : [];

      // Resolve refs to SHAs for stability
      const [resolvedFrom, resolvedTo] = await Promise.all([
        resolveRef(fromRef, workDir),
        resolveRef(toRef, workDir),
      ]);

      // Cache the structured result
      const cacheId = randomUUID();
      diffCache.set(cacheId, {
        from: fromRef,
        to: toRef,
        resolvedFrom,
        resolvedTo,
        repoRoot: repoCheck.root,
        path,
        files,
        createdAt: Date.now(),
      });

      const label = `Diff ${fromRef} → ${toRef}`;
      return {
        content: [
          {
            type: "text" as const,
            text: `${label} (displayed in VoxPilot diff viewer):\n${statOutput}\n[ref:${cacheId}]`,
          },
        ],
      };
    },
  );

  return server;
}

// ── Stateful session management ─────────────────────────────────

const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();

export function createMcpRouter(workDir: string) {
  const router = new Hono();

  router.all("/", async (c) => {
    const sessionId = c.req.header("mcp-session-id");

    // Existing session — reuse transport
    if (sessionId) {
      const transport = transports.get(sessionId);
      if (transport) {
        return transport.handleRequest(c.req.raw);
      }
    }

    // New initialization request — create transport + server
    if (c.req.method === "POST") {
      const body = await c.req.json();
      if (isInitializeRequest(body)) {
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, transport);
          },
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            transports.delete(transport.sessionId);
          }
        };

        const server = createMcpServer(workDir);
        await server.connect(transport);
        return transport.handleRequest(c.req.raw, { parsedBody: body });
      }
    }

    return c.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      },
      400,
    );
  });

  return router;
}
