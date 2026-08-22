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
      "max-depth": ["error", 3],
      complexity: ["error", 12],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true }],
      eqeqeq: ["error", "always"],
      "no-console": "error",
    },
  },
);
