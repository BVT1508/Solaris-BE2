import globals from "globals";
import pluginJs from "@eslint/js";

/** @type {import('eslint').Linter.Config[]} */
export default [
  { ignores: ["node_modules/", ".wrangler/", "frontend-dist/"] },
  {
    // Code chạy trong Worker: ES modules, API chuẩn web (fetch, crypto, WebSocket...).
    files: ["src/**/*.js"],
    languageOptions: {
      sourceType: "module",
      globals: {
        ...globals.serviceworker,
        WebSocketPair: "readonly",
        WebSocketRequestResponsePair: "readonly",
      },
    },
  },
  {
    // Script chạy bằng Node trên máy dev.
    files: ["scripts/**/*.mjs", "*.mjs"],
    languageOptions: { sourceType: "module", globals: { ...globals.node } },
  },
  pluginJs.configs.recommended,
  {
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_|^next$" }],
      // Như backend cũ: không console.log rải rác; ghi log qua src/utils/logger.js.
      "no-console": "error",
    },
  },
  {
    files: ["src/utils/logger.js", "scripts/**/*.mjs"],
    rules: { "no-console": "off" },
  },
];
