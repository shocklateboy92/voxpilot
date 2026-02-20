/**
 * Artifact pipeline — orchestrates diff parsing, full-text resolution,
 * HTML rendering, and persistence into a single function called from
 * the agent loop after git_diff / git_show execution.
 */

import type { getDb } from "../db";
import type { ReviewArtifactEvent } from "../schemas/events";
import { parseUnifiedDiff, buildDiffFiles } from "./diff-parser";
import { resolveFullText } from "./diff-fulltext";
import { renderDiffFileHtml } from "./diff-render";
import {
  createArtifact,
  createArtifactFile,
} from "./artifacts";

type Db = ReturnType<typeof getDb>;

export interface ArtifactPipelineInput {
  db: Db;
  sessionId: string;
  toolName: string;
  toolCallId: string;
  commitRef: string | null;
  staged: boolean;
  diffText: string;
  workDir: string;
}

export interface ArtifactPipelineResult {
  artifactId: string;
  event: ReviewArtifactEvent;
}

/**
 * Parse a diff, resolve full text, render HTML, persist, and return
 * the SSE event payload. Returns null if the diff has no files.
 */
export async function createReviewArtifact(
  input: ArtifactPipelineInput,
): Promise<ArtifactPipelineResult | null> {
  const {
    db,
    sessionId,
    toolName,
    toolCallId,
    commitRef,
    staged,
    diffText,
    workDir,
  } = input;

  const artifactId = crypto.randomUUID();

  // 1. Parse the unified diff
  const parsed = parseUnifiedDiff(diffText, artifactId);
  if (parsed.files.length === 0) return null;

  // 2. Build file structures
  const fileSkeletons = buildDiffFiles(parsed, artifactId);

  // 3. Generate title from file paths
  const title = generateTitle(parsed.files.map((f) => f.path));

  // 4. Persist the artifact
  await createArtifact(db, {
    id: artifactId,
    sessionId,
    toolName,
    toolCallId,
    commitRef,
    title,
    totalFiles: parsed.files.length,
    totalAdditions: parsed.totalAdditions,
    totalDeletions: parsed.totalDeletions,
  });

  // 5. For each file: resolve full text, render HTML, persist
  const eventFiles: ReviewArtifactEvent["files"] = [];

  for (const skeleton of fileSkeletons) {
    // Resolve full text (non-blocking failure)
    const fullText = await resolveFullText(
      skeleton.path,
      commitRef,
      staged,
      workDir,
    );

    // Render HTML
    const html = renderDiffFileHtml(
      skeleton.id,
      skeleton.path,
      skeleton.hunksJson,
    );

    // Persist file
    await createArtifactFile(db, {
      id: skeleton.id,
      artifactId,
      path: skeleton.path,
      changeType: skeleton.changeType,
      oldPath: skeleton.oldPath,
      additions: skeleton.additions,
      deletions: skeleton.deletions,
      html,
      hunksJson: skeleton.hunksJson,
      fullTextAvailable: fullText.available,
      fullTextLineCount: fullText.lineCount,
      fullTextContent: fullText.content,
    });

    eventFiles.push({
      id: skeleton.id,
      path: skeleton.path,
      changeType: skeleton.changeType,
      additions: skeleton.additions,
      deletions: skeleton.deletions,
    });
  }

  // 6. Build SSE event payload (metadata only)
  const event: ReviewArtifactEvent = {
    artifactId,
    title,
    status: "pending",
    totalFiles: parsed.files.length,
    totalAdditions: parsed.totalAdditions,
    totalDeletions: parsed.totalDeletions,
    files: eventFiles,
  };

  return { artifactId, event };
}

/**
 * Generate a short changeset title from file paths.
 */
function generateTitle(paths: string[]): string {
  if (paths.length === 0) return "Empty changeset";
  if (paths.length === 1) return `Changes in ${paths[0]}`;
  if (paths.length <= 3) return `Changes in ${paths.join(", ")}`;

  // Find common directory prefix
  const parts = paths.map((p) => p.split("/"));
  const first = parts[0];
  if (!first) return `Changes in ${paths.length} files`;

  let commonDepth = 0;
  for (let i = 0; i < first.length; i++) {
    const segment = first[i];
    if (parts.every((p) => p[i] === segment)) {
      commonDepth = i + 1;
    } else {
      break;
    }
  }

  if (commonDepth > 0) {
    const prefix = first.slice(0, commonDepth).join("/");
    return `Changes in ${prefix}/ (${paths.length} files)`;
  }

  return `Changes in ${paths.length} files`;
}
