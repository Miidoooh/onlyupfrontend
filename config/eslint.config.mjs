export default [
  {
    ignores: ["dist/**", ".next/**", "coverage/**", "node_modules/**"]
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module"
    },
    rules: {
      "no-console": "off",
      "no-unused-vars": "off"
    }
  }
];
