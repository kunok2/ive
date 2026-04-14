## 설계

### 현재 상황

| 구분 | 상태 | 설명 |
|---|---|---|
| GitLab | 구현됨 | addGitLabSpentTime API가 이미 있으며, mr-creator.ts:111,131에서 사용 중 |
| GitHub | 미지원 | GitHub API는 이슈 spent time 미지원 (GitHub는 기본적으로 time tracking 없음) |
| 가이드 | 불완전 | CLAUDE.md/AGENTS.md에 이슈 등록 가이드는 있으나, 작업 시간 측정 안내 없음 |

---

### 제안

#### 1. GitLab 소요시간 등록
- 상태: 이미 구현됨
- 동작: 개발 완료 시 addGitLabSpentTime 호출하여 duration 등록
- 형식: 1h 30m 또는 90m (GitLab API가 자동 파싱)

#### 2. GitHub 대안
- GitHub는 native time tracking 없음
- 대안: 이슈 코멘트에 Duration: 1h 30m 형식으로 기록 (현재 구현된 방식)
- 코멘트의 duration은 사람이 수동으로 GitHub 타사 time tracking 플러그인에 입력 가능

#### 3. 가이드 업데이트
CLAUDE.md/AGENTS.md의 IVE 섹션에 다음 추가:

```
### 소요시간 기록

- GitLab: 작업 완료 시 자동으로 spent time 기록됨
- GitHub: 코멘트에 Duration이 표시되나, 수동으로 time tracking 필요
```

---

### 결정 필요

1. 현재 GitLab 소요시간 기록으로 충분한지?
2. 가이드에 시간 기록 관련 내용 추가?