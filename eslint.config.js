import tsplugin from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  { ignores: ["dist/**", "node_modules/**", "web/public/**", "**/*.d.ts", "target/**"] },
  {
    files: ["web/src/**/*.ts", "tools/**/*.mjs", "schema/**/*.ts"],
    languageOptions: { parser: tsparser, ecmaVersion: 2022, sourceType: "module" },
    plugins: { "@typescript-eslint": tsplugin },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-undef": "off",
      "prefer-const": "warn",
    },
  },
];
