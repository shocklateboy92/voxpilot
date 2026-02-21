export { resolvePath, simpleResult, type Tool, type ToolResult } from "./base";
export { CopilotAgentTool, copilotAgentParameters } from "./copilot-agent";
export { GitDiffTool, gitDiffParameters } from "./git-diff";
export { GitShowTool, gitShowParameters } from "./git-show";
export { GlobSearchTool } from "./glob-search";
export { GrepSearchTool } from "./grep-search";
export { ListDirectoryTool } from "./list-directory";
export { ReadFileTool } from "./read-file";
export { ReadFileExternalTool } from "./read-file-external";
export { ToolRegistry } from "./registry";

import { CopilotAgentTool } from "./copilot-agent";
import { GitDiffTool } from "./git-diff";
import { GitShowTool } from "./git-show";
import { GlobSearchTool } from "./glob-search";
import { GrepSearchTool } from "./grep-search";
import { ListDirectoryTool } from "./list-directory";
import { ReadFileTool } from "./read-file";
import { ReadFileExternalTool } from "./read-file-external";
import { ToolRegistry } from "./registry";

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
