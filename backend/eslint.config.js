import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "coverage", "src/generated"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // `_`-prefixed params are intentionally unused (e.g. Express needs 4 args to see an error handler).
    rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }] },
  },
);
