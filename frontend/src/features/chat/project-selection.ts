import type { Project } from "../../platform/api-client";

/** The service install directory can be registered as a project on startup. */
export function isSelectableProject(
  project: Pick<Project, "canonical" | "vcs">,
): boolean {
  return (
    project.vcs === "git" ||
    !project.canonical.replace(/\/+$/, "").endsWith("/.local/share/voxpilot")
  );
}
