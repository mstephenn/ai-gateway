// @ts-check
// Lighter sibling of packages/core/eslint.config.mjs — this package is a
// small, type-only DTO/contract library shared between core and the UI, so
// it skips the route/complexity carve-outs the backend config needs.
import js from "@eslint/js";
import typescript from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";
import prettier from "eslint-plugin-prettier";
import prettierConfig from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import-x";

export default [
  js.configs.recommended,
  prettierConfig,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": typescript,
      import: importPlugin,
      prettier: prettier,
    },
    settings: {
      "import-x/resolver": {
        typescript: { alwaysTryTypes: true, project: "./tsconfig.json" },
      },
    },
    rules: {
      "import/order": [
        "warn",
        {
          groups: ["builtin", "external", "internal", ["parent", "sibling", "index"]],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      "import/no-duplicates": "error",
      "import/no-unresolved": "error",
      "no-duplicate-imports": "off",

      "no-undef": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", disallowTypeAnnotations: false },
      ],
      "@typescript-eslint/consistent-type-exports": "warn",

      "prefer-const": "error",
      "no-var": "error",
      eqeqeq: ["error", "smart"],

      "prettier/prettier": "warn",
    },
  },
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/*.d.ts"],
  },
];
