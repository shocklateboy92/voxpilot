import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("ix_messages_session").on(table.sessionId, table.id)],
);
