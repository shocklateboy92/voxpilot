import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import githubDark from "shiki/themes/github-dark-high-contrast.mjs";
import githubLight from "shiki/themes/github-light-high-contrast.mjs";
import type { ThemedTokenWithVariants } from "shiki/types";
import { fileExtension } from "../file-preview";

const grammars = [
  {
    extensions: ["ts", "mts", "cts"],
    lang: "typescript",
    load: () => import("shiki/langs/typescript.mjs"),
  },
  {
    extensions: ["tsx"],
    lang: "tsx",
    load: () => import("shiki/langs/tsx.mjs"),
  },
  {
    extensions: ["js", "mjs", "cjs"],
    lang: "javascript",
    load: () => import("shiki/langs/javascript.mjs"),
  },
  {
    extensions: ["jsx"],
    lang: "jsx",
    load: () => import("shiki/langs/jsx.mjs"),
  },
  {
    extensions: ["py", "pyi"],
    lang: "python",
    load: () => import("shiki/langs/python.mjs"),
  },
  {
    extensions: ["rs"],
    lang: "rust",
    load: () => import("shiki/langs/rust.mjs"),
  },
  { extensions: ["c"], lang: "c", load: () => import("shiki/langs/c.mjs") },
  {
    extensions: ["cc", "cpp", "cxx", "h", "hh", "hpp", "hxx"],
    lang: "cpp",
    load: () => import("shiki/langs/cpp.mjs"),
  },
  {
    extensions: ["json"],
    lang: "json",
    load: () => import("shiki/langs/json.mjs"),
  },
  {
    extensions: ["yaml", "yml"],
    lang: "yaml",
    load: () => import("shiki/langs/yaml.mjs"),
  },
  {
    extensions: ["sh", "bash", "zsh"],
    lang: "shellscript",
    load: () => import("shiki/langs/shellscript.mjs"),
  },
  {
    extensions: ["css"],
    lang: "css",
    load: () => import("shiki/langs/css.mjs"),
  },
  {
    extensions: ["html", "htm"],
    lang: "html",
    load: () => import("shiki/langs/html.mjs"),
  },
  {
    extensions: ["md", "markdown"],
    lang: "markdown",
    load: () => import("shiki/langs/markdown.mjs"),
  },
];

const MAX_FILE_LENGTH = 100_000;
const MAX_LINE_LENGTH = 2_000;

let highlighter: ReturnType<typeof createHighlighterCore> | undefined;

export interface DiffHighlight {
  before: ThemedTokenWithVariants[][];
  after: ThemedTokenWithVariants[][];
}

export async function highlightDiff(
  filePath: string,
  before: string,
  after: string,
): Promise<DiffHighlight | undefined> {
  if (Math.max(before.length, after.length) > MAX_FILE_LENGTH) return;
  const tokenize = await codeTokenizer(filePath);
  if (!tokenize) return;
  try {
    const afterTokens = tokenize(after);
    return {
      before: before === after ? afterTokens : tokenize(before),
      after: afterTokens,
    };
  } catch {
    return undefined;
  }
}

export async function highlightCode(
  filePath: string,
  text: string,
): Promise<ThemedTokenWithVariants[][] | undefined> {
  if (text.length > MAX_FILE_LENGTH) return;
  try {
    return (await codeTokenizer(filePath))?.(text);
  } catch {
    return undefined;
  }
}

async function codeTokenizer(filePath: string) {
  const extension = fileExtension(filePath);
  const grammar =
    extension &&
    grammars.find(({ extensions }) => extensions.includes(extension));
  if (!grammar) return;

  try {
    highlighter ??= createHighlighterCore({
      engine: createJavaScriptRegexEngine({ forgiving: true }),
      themes: [githubDark, githubLight],
      langs: [],
    });
    const instance = await highlighter;
    if (!instance.getLoadedLanguages().includes(grammar.lang)) {
      await instance.loadLanguage(grammar.load);
    }

    return (source: string) =>
      instance.codeToTokensWithThemes(source, {
        lang: grammar.lang,
        themes: { dark: githubDark.name, light: githubLight.name },
        tokenizeMaxLineLength: MAX_LINE_LENGTH,
        tokenizeTimeLimit: 20,
      });
  } catch {
    // Highlighting is optional; a grammar or engine failure must not block rendering.
    return undefined;
  }
}
