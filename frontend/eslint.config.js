import solid from "eslint-plugin-solid/configs/typescript";
import * as tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/**/*.{ts,tsx}"],
    ...solid,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "tsconfig.json",
      },
    },
  },
  {
    files: ["src/ui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/app/**", "**/features/**", "**/platform/api-client", "**/platform/rpc", "**/platform/connection", "@plugin/*", "@opencode/*"],
              message: "UI primitives receive data and callbacks through props; keep application state and transport in their owning feature or app module.",
            },
          ],
        },
      ],
    },
  },
];
