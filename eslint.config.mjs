import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import jsxA11yPlugin from "eslint-plugin-jsx-a11y";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import globals from "globals";

const sourceFiles = ["**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts}"];
const typeScriptFiles = ["**/*.{ts,tsx,mts,cts}"];
const typeScriptRecommended = tsPlugin.configs["flat/recommended"].map((config) => ({
  ...config,
  files: typeScriptFiles
}));

export default [
  {
    ignores: [
      ".next/**",
      "next-env.d.ts",
      "node_modules/**",
      "out/**",
      "output/**",
      "outputs/**",
      "tmp/**",
      "supabase/.temp/**"
    ]
  },
  {
    ...js.configs.recommended,
    files: sourceFiles
  },
  ...typeScriptRecommended,
  {
    files: sourceFiles,
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      },
      parserOptions: {
        ecmaFeatures: { jsx: true }
      }
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "@next/next": nextPlugin,
      "jsx-a11y": jsxA11yPlugin,
      react: reactPlugin,
      "react-hooks": reactHooksPlugin
    },
    settings: {
      react: { version: "detect" }
    },
    rules: {
      ...reactPlugin.configs.flat.recommended.rules,
      ...reactPlugin.configs.flat["jsx-runtime"].rules,
      ...reactHooksPlugin.configs["recommended-latest"].rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      "@typescript-eslint/no-explicit-any": "warn",
      "jsx-a11y/alt-text": ["warn", { elements: ["img"], img: ["Image"] }],
      "jsx-a11y/aria-props": "warn",
      "jsx-a11y/aria-proptypes": "warn",
      "jsx-a11y/aria-unsupported-elements": "warn",
      "jsx-a11y/role-has-required-aria-props": "warn",
      "jsx-a11y/role-supports-aria-props": "warn",
      "react/prop-types": "off"
    }
  }
];
