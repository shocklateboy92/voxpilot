export { type Tool, type ToolResult, resolvePath, simpleResult } from "./base";
export { ToolRegistry } from "./registry";
export { ReadFileTool } from "./read-file";
export { ReadFileExternalTool } from "./read-file-external";
export { ListDirectoryTool } from "./list-directory";
export { GrepSearchTool } from "./grep-search";
export { GlobSearchTool } from "./glob-search";
export { GitDiffTool, gitDiffParameters } from "./git-diff";
export { GitShowTool, gitShowParameters } from "./git-show";
export { CopilotAgentTool, copilotAgentParameters } from "./copilot-agent";

import { ToolRegistry } from "./registry";
import { ReadFileTool } from "./read-file";
import { ReadFileExternalTool } from "./read-file-external";
import { ListDirectoryTool } from "./list-directory";
import { GrepSearchTool } from "./grep-search";
import { GlobSearchTool } from "./glob-search";
import { GitDiffTool } from "./git-diff";
import { GitShowTool } from "./git-show";
import { CopilotAgentTool } from "./copilot-agent";

function buildDefaultRegistry(): ToolRegistry {
  const reg = new ToolRegistry();
  reg.register(new ReadFileTool());
  reg.register(new ListDirectoryTool());
  reg.register(new GrepSearchTool());
  reg.register(new GlobSearchTool());
  reg.register(new ReadFileExternalTool());
  reg.register(new GitDiffTool());
  reg.register(new GitShowTool());
  reg.register(new CopilotAgentTool());
  return reg;
}

export const defaultRegistry = buildDefaultRegistry();
