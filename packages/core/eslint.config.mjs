// @ts-check
// Tuned for this project's stack: Fastify + Prisma + native ESM.
import js from "@eslint/js";
import typescript from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";
import prettier from "eslint-plugin-prettier";
import prettierConfig from "eslint-config-prettier";

import importPlugin from "eslint-plugin-import-x";
import unicornPlugin from "eslint-plugin-unicorn";
import jsdocPlugin from "eslint-plugin-jsdoc";

export default [
  js.configs.recommended,
  prettierConfig,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        NodeJS: "readonly",
        fetch: "readonly",
        Request: "readonly",
        Response: "readonly",
        Headers: "readonly",
        TextDecoderStream: "readonly",
        URLSearchParams: "readonly",
        URL: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
        structuredClone: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": typescript,
      import: importPlugin,
      unicorn: unicornPlugin,
      jsdoc: jsdocPlugin,
      prettier: prettier,
    },
    settings: {
      "import-x/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: "./tsconfig.json",
        },
      },
    },
    rules: {
      // ── Import organization ──────────────────────────────────────────
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

      // ── TypeScript correctness (kept as hard errors — genuine bugs) ──
      // no-undef can't see TS ambient/lib types (RequestInit, etc.) and
      // false-flags them; tsc already catches genuinely undefined identifiers.
      "no-undef": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-function-return-type": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", disallowTypeAnnotations: false },
      ],
      "@typescript-eslint/consistent-type-exports": "warn",

      // ── Naming conventions (warn only — this codebase has legitimate ──
      // ── snake_case at Prisma/wire boundaries, e.g. OpenAI-shaped JSON)
      "@typescript-eslint/naming-convention": [
        "warn",
        { selector: "objectLiteralProperty", format: null, modifiers: ["requiresQuotes"] },
        { selector: "typeProperty", format: null, modifiers: ["requiresQuotes"] },
        {
          selector: "objectLiteralProperty",
          format: null,
          custom: { regex: "^[a-zA-Z0-9_-]+$", match: true },
        },
        { selector: "interface", format: ["PascalCase"] },
        { selector: "typeAlias", format: ["PascalCase"] },
        { selector: "class", format: ["PascalCase"] },
        { selector: "enum", format: ["PascalCase"] },
        { selector: "enumMember", format: ["UPPER_CASE"] },
        {
          selector: "variable",
          format: ["camelCase", "PascalCase", "UPPER_CASE"],
          leadingUnderscore: "allow",
        },
        { selector: "function", format: ["camelCase"] },
        { selector: "method", format: ["camelCase"], leadingUnderscore: "allow" },
        {
          selector: "property",
          format: ["camelCase", "PascalCase", "UPPER_CASE", "snake_case"],
          leadingUnderscore: "allow",
          filter: { regex: "^(@|\\d+|Body|Params|Query|Headers)", match: false },
        },
        {
          selector: "typeProperty",
          format: ["camelCase", "PascalCase", "UPPER_CASE", "snake_case"],
          leadingUnderscore: "allow",
        },
        { selector: "parameter", format: ["camelCase"], leadingUnderscore: "allow" },
      ],

      // ── File naming ────────────────────────────────────────────────────
      "unicorn/filename-case": ["warn", { cases: { camelCase: true, pascalCase: true, kebabCase: true } }],

      // ── JSDoc — diagnostics only, no autofix stubs ───────────────────────
      "jsdoc/require-jsdoc": "off",
      "jsdoc/require-param": "off",
      "jsdoc/require-param-description": "off",
      "jsdoc/require-returns": "off",
      "jsdoc/require-returns-description": "off",
      "jsdoc/check-param-names": "warn",
      "jsdoc/valid-types": "warn",
      "jsdoc/check-types": "warn",

      // ── Real-bug-shaped rules — errors ──────────────────────────────────
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      "prefer-const": "error",
      "no-var": "error",
      eqeqeq: ["error", "smart"],
      "no-throw-literal": "error",
      // Superseded by import/no-duplicates above, which correctly allows a
      // separate `import type { X }` alongside `import { y }` from the same
      // module — the base rule doesn't understand that split and false-flags it.
      "no-duplicate-imports": "off",
      "no-unused-expressions": "error",

      // ── Best practices — warn (style, not correctness) ──────────────────
      curly: ["warn", "all"],
      "dot-notation": "warn",
      "no-else-return": "warn",
      "no-lonely-if": "warn",
      "no-useless-return": "warn",
      "prefer-template": "warn",
      yoda: "warn",

      // ── Size/complexity — warn; a guideline to apply going forward, ──
      // ── not a retroactive rewrite of existing files.
      "max-lines": ["warn", { max: 300, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["warn", { max: 60, skipBlankLines: true, skipComments: true, IIFEs: true }],
      complexity: ["warn", 12],
      "max-depth": ["warn", 4],
      "max-params": ["warn", 5],

      // ── Modern JS practices ──────────────────────────────────────────────
      "unicorn/prefer-node-protocol": "warn",
      "unicorn/no-array-for-each": "off",
      "unicorn/prefer-array-some": "warn",
      "unicorn/prefer-module": "off", // this package already targets native ESM

      // ── Prettier integration ─────────────────────────────────────────────
      "prettier/prettier": "warn",
    },
  },
  {
    // Test files: relax rules that fight test-double/mocking idioms
    files: ["test/**/*.ts", "scripts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/naming-convention": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-console": "off",
      // Test doubles for streams that fail before yielding anything are a
      // legitimate pattern here, not a bug — `chatCompletionStream: vi.fn(async function* () { throw ... })`.
      "require-yield": "off",
      "jsdoc/require-jsdoc": "off",
      "jsdoc/require-param": "off",
      "jsdoc/require-param-description": "off",
      "jsdoc/require-returns": "off",
      "jsdoc/require-returns-description": "off",
      "import/order": "off",
      "prefer-template": "off",
      "max-lines": "off",
      "max-lines-per-function": "off",
      "max-depth": "off",
      complexity: "off",
      "prettier/prettier": "off",
    },
  },
  {
    // Route factories embed lots of inline validation/branching — inherently longer
    files: ["src/routes/**/*.ts"],
    rules: { "max-lines-per-function": "off" },
  },
  {
    // Prisma-generated client — never hand-edited, never linted
    files: ["src/db/generated/**/*.ts"],
    rules: {},
  },
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/*.d.ts",
      "src/db/generated/**",
      "vitest.config.ts",
    ],
  },
];
