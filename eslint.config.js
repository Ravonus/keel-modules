// Flat ESLint config for the verified readable sources.
// Every module and the template lint against the same strict, type-aware bar.
import tseslint from "typescript-eslint";
import { LIMITS } from "./scripts/size-limits.mjs";

export default tseslint.config(
  {
    // Only the readable sources are linted; everything else is tooling or output.
    ignores: ["**/node_modules/**", "catalog/**", "scripts/**", "modules/*/*/*/test/**", "eslint.config.js"],
  },
  {
    files: ["modules/*/*/*/src/**/*.ts", "template/src/**/*.ts"],
    extends: [
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      // Size: a function and a line, which cramming cannot hide. A file's lines are scripts/check-size.mjs's, and functions go by LIMITS below.
      "max-len": ["error", { code: 120, ignoreUrls: true, ignoreRegExpLiterals: true, ignoreTemplateLiterals: true, ignoreStrings: true }],
      "max-statements": ["error", 25],
      "max-statements-per-line": ["error", { max: 1 }],
      "one-var": ["error", "never"],
      "no-multi-assign": "error",
      "max-classes-per-file": ["error", 1],
      // Shape: how much one function takes in and holds in its head.
      "@typescript-eslint/max-params": ["error", { max: 4 }],
      "max-depth": ["error", 3],
      "max-nested-callbacks": ["error", 3],
      complexity: ["error", 12],
      "no-nested-ternary": "error",
      "no-param-reassign": "error",
      eqeqeq: ["error", "always"],
      "no-console": "error",
    },
  },
  // Last match wins here and first in LIMITS, so these go in reverse.
  ...[...LIMITS].reverse().map(({ files, fn }) => ({ files, rules: { "max-lines-per-function": ["error", { max: fn, skipBlankLines: true, skipComments: true }] } })),
  // Data and shader source is long lines by nature.
  { files: ["**/*.data.ts", "**/*.table.ts", "**/*.glsl.ts", "**/*.shader.ts"], rules: { "max-len": "off" } },
);
