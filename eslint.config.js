// Flat ESLint config for the verified readable sources.
// Every module and the template lint against the same strict, type-aware bar.
import tseslint from "typescript-eslint";

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
      // Size: a file, a function, a line. Nothing here can be hidden by cramming, so the three go together.
      "max-lines": ["error", { max: 500, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true }],
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
);
