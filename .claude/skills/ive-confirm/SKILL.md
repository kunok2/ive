---
name: ive-confirm
description: "IVE 이슈를 «확인자»로서 보는 절차 — 「ive:confirm-wait」 건을 「ive:confirming」로 옮기고 반영된 환경에서 접수된 그 증상이 고쳐졌는지 증거와 함께 밟아, 고쳐졌으면 「ive:done」, 여전하면 화면 단서와 함께 「ive:verify-wait」. 「IVE 확인해줘」, 「ive:confirming」 건에 쓴다. 처리는 ive-handle, 검증은 ive-verify."
---

# IVE 이슈 확인 (확인자)

> 짝 스킬: 처리 `ive-handle` · 검증 `ive-verify` · 확인 `ive-confirm`. 단계 라벨의 뜻과 규칙의 이유는 CLAUDE.md 의 「IVE 단계 라벨」 절이 원본이다 — 이 스킬과 다르게 적혀 있거나 프로젝트 자체 규칙이 있으면 그쪽을 따르고 라벨 이름·단계 순서만 이 스킬을 따른다.

확인 = **머지·반영된 것이 실제로 그렇게 동작한다는 것을 남이 봐도 알 수 있게 증명**하는 일이다. 코드를 다시 읽는 자리가 아니다(검증에서 끝났다).

## 체크리스트 — 이 순서대로

1. **대상을 정한다.** 번호가 없으면 `glab api "projects/kojoung%2Five/issues?labels=ive%3Aconfirm-wait&state=opened"` 로 확인대기 목록을 보여 주고 묻는다.
2. **반영됐는지 먼저 본다.** 머지 커밋이 확인할 환경에 실제로 올라갔는지(배포 시각·버전 표시) 본다. 확인용 주소가 IVE 프로젝트 설정에 없습니다. 이슈·MR·README 에서 찾고, 없으면 사용자에게 어디서 확인하면 되는지(로그인이 필요하면 테스트 계정도) 물어 받은 뒤 진행하세요. 임의의 로컬 서버를 띄워 「확인했다」고 하지 않습니다. 반영 전이면 확인이 아니라 **기다림**이다 — 그 사실을 노트에 적고 `ive:confirm-wait` 에 둔다.
3. **⛔ 실제로 밟기 시작할 때 `ive:confirm-wait` → `ive:confirming`.** 기다리는 동안 올려 두지 않는다 — 아무도 안 본 시간이 확인 시간으로 잡힌다. 이동 뒤 단계 라벨이 하나만 남았는지 다시 읽는다.
   ```bash
   glab api --method PUT "projects/kojoung%2Five/issues/<번호>" -f "remove_labels=ive:confirm-wait" -f "add_labels=ive:confirming"
   ```
4. **원 요청으로 돌아간다.** 요청자가 쓴 문장과 결과가 맞는지 본다. 처리·검증 노트의 **「확인 요청」을 전부** 확인 목록에 옮긴다 — 앞 단계가 못 한 검수가 여기서 처음 이뤄진다. 접수자의 브라우저·화면 모드·기기 정보가 본문에 있으면 그대로 따른다.
5. **무엇으로 증명할지 고른다.** 화면=스크린샷(전/후) · API=요청과 응답 그대로 · 규칙·정책=**막혀야 할 입력과 통과해야 할 입력 둘 다** · 배치=실행 로그+처리 건수 · 데이터=같은 쿼리 전/후 건수(읽기 전용) · 권한=권한 **없는** 계정으로 거부되는 것까지.
6. **증명에는 세 가지가 들어간다.** ① 재현 경로(주소·명령·대상 ID) ② 결과(요약이 아니라 붙여넣은 출력·화면) ③ 대조(전/후, 또는 성공·실패 두 케이스). ⛔ 「테스트 통과」「코드 확인함」「로직상 문제 없음」은 증명이 아니다.
   화면은 `npx playwright screenshot --viewport-size=1280,800 "<확인 주소>/경로" after.png` 처럼 찍는다.
7. **증거를 이슈에 올린다.** GitLab 은 `glab api --method POST "projects/kojoung%2Five/uploads" --form "file=@shot.png" --jq .markdown` 가 돌려주는 markdown 을 코멘트에 그대로 넣는다. 코멘트에서 실제로 보이는지 확인한다.
8. **막히면 멈춘다(우회 금지).** 로그인·권한·데이터가 없어 밟을 수 없으면 비슷한 다른 대상으로 대신하지 말고 필요한 것을 노트·보고에 적는다. 못 밟은 항목이 남으면 `ive:done` 로 올리지 않는다.
9. **결론 단계로 옮긴다.** 고쳐졌다 → `ive:confirming` → `ive:done`(완료). 여전하다 → ⛔ **`ive:verify-wait`(검증 대기)** — `ive:todo`(처리대기)로 바로 보내지 않는다. 반려 노트에는 화면을 본 사람만 줄 수 있는 단서를 남긴다: 화면·경로·뷰포트·데이터 / 문제 요소 선택자와 측정값(기대 vs 실제) / 이긴 규칙 / 의심 파일·고칠 방향. 「안 된다」만 적고 돌려보내지 않는다.
   ```bash
   glab issue note <번호> -R kojoung/ive --message "$(cat note.md)"
   glab api --method PUT "projects/kojoung%2Five/issues/<번호>" -f "remove_labels=ive:confirming" -f "add_labels=ive:done"
   ```
10. **`ive-meta` 에 `stage: confirm` 을 넣어 노트 끝에 남긴다.** 형식은 CLAUDE.md 「검증·확인에 쓴 시간과 토큰 남기기」.
11. **내보내기 전 마무리.** 코드만 들어가서는 안 바뀌는 것(기존 데이터 재처리·설정)이 남았으면 대상 건수를 적는다. 후속 작업은 이 이슈에 붙이지 말고 새 이슈로 나눈다.
12. **보고는 10줄 이내.** 첫 줄에 결과(완료·반려·보류) + 현재 라벨.
