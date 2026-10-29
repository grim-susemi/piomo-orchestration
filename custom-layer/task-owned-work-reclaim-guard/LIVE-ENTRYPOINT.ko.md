# stable-500 한 파일 적용 준비안 — 아직 미적용

`live-target.mjs`는 아래 고정 파일만 다룬다. 경로를 바꾸는 옵션이 없다.
기존 `installer.mjs`의 disposable fixture 제한은 그대로다.
이번에는 주입 filesystem 시험만 한다. 실제 실행 옵션은 호출하지 않는다.

```text
C:/Users/USER/.omo-stable-500/staging/memory-rollback-5.1.40-r1/package/plugin/extensions/omo-task.js
버전: 5.1.40
before: 0dd146b930bd525cca12b6b39387a4d07db5cff0f5b6e29f3bf3ef04d2bdf45d
after:  64112d39dcdc24069e759481c92b420a109c879c6fdaab7087de054d573204c4
```

## 명령 — 현재 실행하지 않음

읽기 전용 확인. 생략 시에도 check-only이며 `--dry-run`도 같은 동작이다.

```bat
node "C:/Users/USER/orca/projects/piomo-orchestration-source/custom-layer/task-owned-work-reclaim-guard/live-target.mjs" --check-only
```

실제 적용은 **별도 지휘 GO + 영향 세션 checkpoint + host 정지 조율 후에만** 한다.
아래 GO/checkpoint 파일은 이번 준비 작업에서 생성하지 않는다.

```bat
node "C:/Users/USER/orca/projects/piomo-orchestration-source/custom-layer/task-owned-work-reclaim-guard/live-target.mjs" --execute-live --commander-go "C:/Users/USER/orca/projects/기타 작업/.omo/evidence/overnight-command-20261023/capture-maintenance-live-go.json" --checkpoints "C:/Users/USER/orca/projects/기타 작업/.omo/evidence/overnight-command-20261023/capture-maintenance-live-checkpoints.json"
```

## GO/checkpoint 계약

- GO: `decision=GO_APPLY_TASK_OWNED_WORK_PINNED_OVERLAY`, 위 target 문자열,
  정확한 `beforeSha256`/`afterSha256`, 비어 있지 않은 `checkpointId`.
- Checkpoint manifest: `schema=task-owned-work-live-checkpoints-v1`,
  같은 `checkpointId`/target, `hostQuiescent=true`,
  `allAffectedSessionsCheckpointed=true`.
- `sessions`는 최소 1건. 각 행에 서로 다른 `sessionId`, 실제 `checkpointPath`,
  그 파일 바이트의 소문자 SHA256인 `sha256`이 있어야 한다.
- 승인 자료는 지휘자가 작성한다. 실행기는 일치 여부와 checkpoint 바이트만
  확인하며, host가 실제로 멈췄는지 독립적으로 감시하지 않는다.
  이번 준비 승인 파일은 GO로 인정되지 않는다.

## 파일 처리와 중단 기준

고정 root·package.json·target의 realpath와 일반 파일 여부, 버전을 확인한다.
전체 before가 정확할 때 원 6변환만 적용하고 전체 after를 다시 확인한다.

백업은 target 뒤에 다음 문자열을 붙인 고정 형제 파일이다.

```text
.task-owned-work-reclaim-guard.live-before-0dd146b930bd525cca12b6b39387a4d07db5cff0f5b6e29f3bf3ef04d2bdf45d.bak
```

`wx`로 원 바이트를 독점 생성·flush한다. 기존 백업은 동일 before 바이트일
때만 재사용하며 덮어쓰지 않는다. stage도 `wx`로 생성·flush하고 realpath와
after를 검증한다. 버전·realpath·target before·백업을 교체 직전에 다시 확인한
뒤 같은 디렉터리 rename으로 target을 교체한다. 교체 뒤 after도 확인한다.

다른 해시·부분 패치·링크·외부로 향하는 realpath·다른 백업·기존 stage·변경된
checkpoint는 중단한다. 교체 뒤 다른 작성자가 바꾼 경우 자동 복원하지 않는다.
원자 rename은 비협조 작성자에 대한 compare-and-swap이 아니다. 따라서 실제
checkpoint와 쓰기 정지가 필수다. 설치기는 기존 process를 종료하지 않는다.
이미 after이며 정상 백업이 있으면 파일을 다시 쓰지 않는다.

## 영향 세션 갱신 — 지금 수행하지 않음

1. 해당 overlay를 읽은 parent host와 resident child를 지휘자가 식별한다.
   각 세션이 현재 계획·산출물·미완 작업·재개 명령·소유 job을 checkpoint에
   남기고 `RESTART-READY`를 회신해야 한다. 진행 중 job을 몰래 끊지 않는다.
2. 지휘자는 전체 checkpoint와 host 쓰기 정지를 확인하고 별도 GO를 남긴다.
   이 유지보수 대화는 조정과 기록을 마친 뒤 마지막으로 갱신한다.
3. 별도 적용 승인 뒤 위 check-only → execute-live → check-only 순서로 확인한다.
   오류가 나면 중단하며 해시를 바꾸거나 다른 patch를 재생성하지 않는다.
4. 디스크 교체만으로 기존 process가 바뀌지 않는다. 지휘자가 checkpoint에서
   세션을 갱신하고 stable-500 기존 launcher로 **새 host process**를 연다.
   새 대화창이나 새 CLI PID가 기존 shared host에 붙는 경우는 fresh host가
   아니다. 실제 backend host PID도 새로워야 한다.
   `/reload`만으로 새 코드가 로드됐다고 인정하지 않는다.
5. 새 host PID·실제 로드한 task 모듈 경로·그 모듈의 after 해시를 확인한다.
   runtime snapshot이 before이거나 로드 경로를 확인할 수 없으면 중단한다.
   설정·런처를 바꾸거나 snapshot을 임의 삭제해 우회하지 않는다.

## fresh-host 실제 task/PTY 수용 절차 — 별도 실행 승인 필요

새 host가 after를 로드한 뒤, 테스트 child 하나에서 네이티브 PTY job을 시작한다.
job은 stdin의 명시적 완료 신호를 기다리며 CPU 작업을 하지 않는다.
stdin 구독을 READY 출력보다 먼저 설치한다. 예시 job 본문:

```js
process.stdin.once("data", () => {
  console.log("PTY_ACCEPT_DONE");
  process.exit(0);
});
console.log("PTY_ACCEPT_READY");
```

1. child는 실제 native background 도구로 이 job을 띄우고 job handle·PID·READY를
   checkpoint에 기록한다. child의 대화 turn은 끝나도 job은 계속 살아 있어야 한다.
   완료 알림 구독은 job 완료 신호 전에 설치한다.
2. parent는 정상 idle sweep 기간(현재 900000ms)을 실제로 넘긴 뒤 원래 child
   sessionId·resident handle·job PID가 살아 있는지 1회 확인한다.
   이 장시간 검증은 **이번 준비 단계에서는 실행하지 않는다**.
3. 같은 child에 재개 요청을 보내 stdin 완료 신호를 1회 전달한다.
   원래 handle의 `PTY_ACCEPT_DONE`·실제 종료0·부모의 완료 알림을 확인한다.
   새 child를 만들어 완료를 대신하면 실패다.
4. 완료 뒤 정상 sweep에서 해당 resident가 회수 가능한지도 확인한다.
   유지 중 abort/dispose, job 소실, 완료 알림 유실, 원래 session 교체는 실패다.
   실패하면 제품 재개는 보류하고 원시 기록을 보존한다.

SDK의 synthetic wake/getter PASS와 주입 fixture PASS는 이 실제 task/PTY
수용을 대신하지 않는다. 이 절차는 제품·GPU·OBS·게임 실행을 포함하지 않는다.
