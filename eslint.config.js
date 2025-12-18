import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

export default defineConfig([
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.ts"],
    plugins: {
      "@typescript-eslint": tseslint,
    },
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
      globals: {
        ...globals.browser,
        ...globals.node,
        // Obsidian globals
        createDiv: "readonly",
        createEl: "readonly",
        createSpan: "readonly",
        createFragment: "readonly",
      },
    },
    rules: {
      "obsidianmd/sample-names": "off",
      // Allow console for debugging - Obsidian allows console.debug/warn/error
      "no-console": ["error", { allow: ["warn", "error", "debug"] }],
      // Disable overly strict Octokit typing rules - library types are complex
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      // Enable stricter rules required by ObsidianReviewBot
      "@typescript-eslint/no-redundant-type-constituents": "error",
      "@typescript-eslint/require-await": "error",
    },
  },
  {
    ignores: ["node_modules/**", "main.js", "*.mjs", "tests/**", "eslint.config.js", "jest.config.js"],
  },
]);


