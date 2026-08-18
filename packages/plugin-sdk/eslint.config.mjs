// @ts-check
// Lightest sibling of packages/core/eslint.config.mjs — this package has no
// tsconfig of its own (it re-exports types straight from core's src), so it
// runs non-type-aware TS linting only, not the type-checked rule set.
import js from "@eslint/js";
import typescript from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";
import prettier from "eslint-plugin-prettier";
import prettierConfig from "eslint-config-prettier";

export default [
  js.configs.recommended,
  prettierConfig,
  {
    files: ["**/*.ts"],
    languageOptions: { parser: typescriptParser },
    plugins: { "@typescript-eslint": typescript, prettier: prettier },
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "prefer-const": "error",
      "no-var": "error",
      eqeqeq: ["error", "smart"],
      "prettier/prettier": "warn",
    },
  },
  { ignores: ["**/node_modules/**", "**/dist/**", "**/*.d.ts"] },
];
