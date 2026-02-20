import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { DiffHunk } from "./schemas/diff-document";

export interface ToolCallInfo {
  id: string;
  name: string;
  arguments: string;
}

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey().notNull(),
  title: text("title").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const messages = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    toolCalls: text("tool_calls", { mode: "json" }).$type<ToolCallInfo[]>(),
    toolCallId: text("tool_call_id"),
    artifactId: text("artifact_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("ix_messages_session").on(table.sessionId, table.id)],
);

// ── Review artifacts ─────────────────────────────────────────────────────────

export const reviewArtifacts = sqliteTable("review_artifacts", {
  id: text("id").primaryKey().notNull(),
  version: integer("version").notNull().default(1),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  toolName: text("tool_name").notNull(),
  toolCallId: text("tool_call_id").notNull(),
  commitRef: text("commit_ref"),
  title: text("title").notNull(),
  status: text("status").notNull().default("pending"),
  totalFiles: integer("total_files").notNull(),
  totalAdditions: integer("total_additions").notNull(),
  totalDeletions: integer("total_deletions").notNull(),
  createdAt: text("created_at").notNull(),
});

export const artifactFiles = sqliteTable(
  "artifact_files",
  {
    id: text("id").primaryKey().notNull(),
    artifactId: text("artifact_id")
      .notNull()
      .references(() => reviewArtifacts.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    changeType: text("change_type").notNull(),
    oldPath: text("old_path"),
    additions: integer("additions").notNull(),
    deletions: integer("deletions").notNull(),
    viewed: integer("viewed", { mode: "boolean" }).notNull().default(false),
    html: text("html").notNull(),
    hunksJson: text("hunks_json", { mode: "json" }).$type<DiffHunk[]>(),
    fullTextAvailable: integer("full_text_available", { mode: "boolean" })
      .notNull()
      .default(false),
    fullTextLineCount: integer("full_text_line_count"),
    fullTextContent: text("full_text_content"),
    fullTextHtml: text("full_text_html"),
  },
  (table) => [index("ix_artifact_files_artifact").on(table.artifactId)],
);

export const reviewComments = sqliteTable(
  "review_comments",
  {
    id: text("id").primaryKey().notNull(),
    artifactId: text("artifact_id")
      .notNull()
      .references(() => reviewArtifacts.id, { onDelete: "cascade" }),
    fileId: text("file_id")
      .notNull()
      .references(() => artifactFiles.id, { onDelete: "cascade" }),
    lineId: text("line_id"),
    lineNumber: integer("line_number"),
    content: text("content").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("ix_review_comments_artifact").on(table.artifactId)],
);
