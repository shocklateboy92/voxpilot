/** Fetch native bootstrap snapshots before the parent starts event streaming. */

import type {
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
} from "./api-client";
import {
  client,
  fetchAgents,
  fetchPendingPermissions,
  fetchPendingQuestions,
  fetchProjects,
} from "./api-client";
import type { AppState } from "./types";

async function fetchAllSessions(): Promise<Session[]> {
  const sessions: Session[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.session.list({
      limit: 100,
      ...(cursor === undefined ? { order: "desc" } : { cursor }),
    });
    sessions.push(...page.data);
    cursor = page.cursor.next ?? undefined;
  } while (cursor !== undefined);
  return sessions.sort((a, b) => b.time.updated - a.time.updated);
}

export async function init(): Promise<AppState> {
  const [location, agents, sessions, active] = await Promise.all([
    client.location.get(),
    fetchAgents(),
    fetchAllSessions(),
    client.session.active(),
  ]);
  // Resolve the default location first so its project is registered in the list.
  const projects = await fetchProjects();
  const activeSessionIDs = Object.keys(active);
  const [permissions, questions] = await Promise.all([
    Promise.all(activeSessionIDs.map(fetchPendingPermissions)),
    Promise.all(activeSessionIDs.map(fetchPendingQuestions)),
  ]);

  const sessionPermissions: Record<string, PermissionRequest> = {};
  for (const permission of permissions.flat()) {
    sessionPermissions[permission.sessionID] ??= permission;
  }
  const sessionQuestions: Record<string, QuestionRequest> = {};
  for (const question of questions.flat()) {
    sessionQuestions[question.sessionID] ??= question;
  }
  const sessionStatuses: Record<string, SessionStatus> = {};
  for (const [sessionID, status] of Object.entries(active)) {
    // SessionActive reports running drains, not the event's SessionStatus union.
    if (status.type === "running")
      sessionStatuses[sessionID] = { type: "busy" };
  }

  return {
    sessions,
    agents: agents.filter(
      (agent) =>
        (agent.mode === "primary" || agent.mode === "all") && !agent.hidden,
    ),
    projects,
    currentProject: projects.find(
      (project) => project.id === location.project.id,
    ),
    messages: [],
    gitBranch: null,
    changedFiles: [],
    sessionError: false,
    errorMessage: null,
    sessionStatuses,
    sessionPermissions,
    sessionQuestions,
    sessionErrors: {},
  };
}
