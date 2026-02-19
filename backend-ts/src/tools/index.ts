export { type Tool, resolvePath } from "./base";
export { ToolRegistry } from "./registry";
export { ReadFileTool } from "./read-file";
export { ReadFileExternalTool } from "./read-file-external";
export { ListDirectoryTool } from "./list-directory";
export { GrepSearchTool } from "./grep-search";
export { GlobSearchTool } from "./glob-search";

import { ToolRegistry } from "./registry";
import { ReadFileTool } from "./read-file";
import { ReadFileExternalTool } from "./read-file-external";
import { ListDirectoryTool } from "./list-directory";
import { GrepSearchTool } from "./grep-search";
import { GlobSearchTool } from "./glob-search";

function buildDefaultRegistry(): ToolRegistry {
  const reg = new ToolRegistry();
  reg.register(new ReadFileTool());
  reg.register(new ListDirectoryTool());
  reg.register(new GrepSearchTool());
  reg.register(new GlobSearchTool());
  reg.register(new ReadFileExternalTool());
  return reg;
}

export const defaultRegistry = buildDefaultRegistry();
