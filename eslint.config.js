import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

export default defineConfig([
  {
    ignores: ["node_modules/**", "main.js", "*.mjs", "*.cjs", "tests/**", "eslint.config.js"],
  },
  {
    files: ["**/*.ts"],
    extends: [
      ...obsidianmd.configs.recommended,
      ...tseslint.configs.recommended,
    ],
    languageOptions: {
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
]);


