import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 런타임/에이전트 생성물 — 린트 대상 아님 (에이전트 클론·opencode 임시 디렉토리)
    "workspaces/**",
    ".octmp/**",
  ]),
]);

export default eslintConfig;
