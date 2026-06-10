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
  {
    rules: {
      // `_` 접두사는 "의도적으로 안 씀"을 뜻하는 표준 관례. 코드베이스가 이미
      // _projectId·_auto 등으로 이 관례를 쓰고 있으므로 lint도 이를 존중한다.
      // catch(e)에서 에러를 안 쓰는 경우도 흔하므로 무시한다.
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrors: "none",
        destructuredArrayIgnorePattern: "^_",
      }],
    },
  },
]);

export default eslintConfig;
