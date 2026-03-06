/**
 * Bootstrap data fetcher — fetches all server data needed before the UI renders.
 *
 * Returns a plain AppState object. store.ts calls this via top-level await
 * to populate createStore() before any consumer module executes.
 */

import type { PermissionRequest, Project, QuestionRequest, Session } from "./api-client";
import {
  client,
  fetchAgents,
  fetchCurrentProject,
  fetchPendingPermissions,
  fetchPendingQuestions,
  fetchProjects,
} from "./api-client";
import type { AppState } from "./types";

/**
 * Fetch sessions from all projects.
 */
async function fetchAllSessions(projects: Project[]): Promise<Session[]> {
  if (projects.length <= 1) {
    const result = await client.session.list();
    return result.data ?? [];
  }

  const results = await Promise.all(
    projects.map((p) => client.session.list({ directory: p.worktree })),
  );
  const allSessions = results.flatMap((r) => r.data ?? []);

  // Deduplicate by session ID
  const seen = new Set<string>();
  const unique: Session[] = [];
  for (const s of allSessions) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      unique.push(s);
    }
  }

  unique.sort((a, b) => b.time.updated - a.time.updated);
  return unique;
}

/**
 * Fetch all pending permissions across all projects.
 * Returns a Record keyed by sessionID (at most one per session).
 */
async function fetchAllPendingPermissions(
  projects: Project[],
): Promise<Record<string, PermissionRequest>> {
  const perms = (
    await Promise.all(projects.map((p) => fetchPendingPermissions(p.worktree)))
  ).flat();

  const map: Record<string, PermissionRequest> = {};
  for (const perm of perms) {
    map[perm.sessionID] = perm;
  }
  return map;
}

/**
 * Fetch all pending questions across all projects.
 * Returns a Record keyed by sessionID (at most one per session).
 */
async function fetchAllPendingQuestions(
  projects: Project[],
): Promise<Record<string, QuestionRequest>> {
  const questions = (
    await Promise.all(projects.map((p) => fetchPendingQuestions(p.worktree)))
  ).flat();

  const map: Record<string, QuestionRequest> = {};
  for (const q of questions) {
    map[q.sessionID] = q;
  }
  return map;
}

export async function init(): Promise<AppState> {
  // Fetch all bootstrap data in parallel
  const [projectList, current, agentList] = await Promise.all([
    fetchProjects(),
    fetchCurrentProject(),
    fetchAgents(),
  ]);

  // Sessions and pending prompts depend on projects (multi-project aggregation)
  const [sessionList, sessionPermissions, sessionQuestions] = await Promise.all([
    fetchAllSessions(projectList),
    fetchAllPendingPermissions(projectList),
    fetchAllPendingQuestions(projectList),
  ]);

  return {
    sessions: sessionList,
    agents: agentList.filter(
      (a) => (a.mode === "primary" || a.mode === "all") && !a.hidden,
    ),
    projects: projectList,
    currentProject: current,
    messages: [],
    gitBranch: null,
    sessionError: false,
    errorMessage: null,
    sessionStatuses: {},
    sessionPermissions,
    sessionQuestions,
    sessionErrors: {},
  };
}
