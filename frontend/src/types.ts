/**
 * Shared type definitions for the app store.
 *
 * Extracted into a standalone module so both init.ts (data fetcher)
 * and store.ts (store owner) can reference AppState without creating
 * a circular dependency.
 */

import type {
  PermissionRequest,
  QuestionRequest,
  SessionStatus,
} from "@opencode-ai/sdk/v2/client";
import type { Agent, Message, MessageWithParts, Part, Project, SdkFile, Session } from "./api-client";

export type { Session, Message, Part, MessageWithParts, Project };

// Re-export PendingPermission type for ToolConfirmBlock
export type PendingPermission = PermissionRequest;

export interface AppState {
  // ── Bootstrap data (fetched once at init) ────────────────────
  sessions: Session[];
  agents: Agent[];
  projects: Project[];
  currentProject: Project | undefined;

  // ── Per-active-session (fetched on session switch, updated by SSE) ──
  messages: MessageWithParts[];
  gitBranch: string | null;
  changedFiles: SdkFile[];
  sessionError: boolean;
  errorMessage: string | null;

  // ── Cross-session SSE state ──────────────────────────────────
  sessionStatuses: Record<string, SessionStatus>;
  sessionPermissions: Record<string, PermissionRequest>;
  sessionQuestions: Record<string, QuestionRequest>;
  sessionErrors: Record<string, string>;

}
