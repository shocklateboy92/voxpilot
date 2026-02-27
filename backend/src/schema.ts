import { relations } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const diffEntries = sqliteTable("diff_entries", {
  id: text("id").primaryKey().notNull(),
  fromRef: text("from_ref").notNull(),
  toRef: text("to_ref").notNull(),
  resolvedFrom: text("resolved_from").notNull(),
  resolvedTo: text("resolved_to").notNull(),
  repoRoot: text("repo_root").notNull(),
  path: text("path"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const diffEntryFiles = sqliteTable(
  "diff_entry_files",
  {
    id: text("id").primaryKey().notNull(),
    entryId: text("entry_id")
      .notNull()
      .references(() => diffEntries.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    additions: integer("additions").notNull(),
    deletions: integer("deletions").notNull(),
    beforeContent: text("before_content").notNull(),
    afterContent: text("after_content").notNull(),
  },
  (table) => [index("idx_diff_entry_files_entry_id").on(table.entryId)],
);

export const diffEntriesRelations = relations(diffEntries, ({ many }) => ({
  files: many(diffEntryFiles),
}));

export const diffEntryFilesRelations = relations(diffEntryFiles, ({ one }) => ({
  entry: one(diffEntries, {
    fields: [diffEntryFiles.entryId],
    references: [diffEntries.id],
  }),
}));
