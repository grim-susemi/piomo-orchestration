# 실사용 적용 승인 제안

## 권고: 파일 복사나 전역 설정 없이 한 대화부터 opt-in

현재까지는 격리 검증만 수행했다. 이 문서의 실행은 별도 승인이 필요하다.
권고 pilot은 `w1:p9V` / `w1:t24`, **OBS NR DLSS5 플러그인 개발 재개**다.
작업이 입력 대기이고 child/DAG 등 활성 작업이 없는 시점에만 정상 종료 후
같은 세션으로 재개한다. 강제 종료나 외부 등록 주입은 하지 않는다.

변경은 다음 실행의 `--extension` 인자 하나다. 설치 bundle, `omo.cmd`,
global settings, global extension discovery 파일을 변경하지 않는다.
다른 대화는 그대로 둔다. 이미 로드된 원본 reporter를 실행 중에 외부에서
교체하거나 release하는 방식은 아니다.

## 확인된 실사용 상태

2026-10-13 읽기 전용 재조회에서 아래 세 pane은 존재하지만 agent가 없었다.
현재 소실 상태를 fixture 성공으로 해결됐다고 표현하지 않는다.

| pane | 대화 | 세션 근거 |
| --- | --- | --- |
| w1:p9V | OBS NR DLSS5 플러그인 개발 재개 | Node 52428 argv의 `--session 01a1263d-2210-7215-991a-096e966c36fe`; 같은 ID의 session header |
| w1:p93 | OptiScaler NR 검증과 DLL 빌드 재개 | Node 80108 argv의 `--session 01a12466-aa9f-74e8-9f13-887e8c17715c`; 같은 ID의 session header |
| w1:pFM | Muse Wonder 컨트리뷰터 버전 확인 | 시작 시각과 맞는 `01a133df-010e-7194-a96a-82a3659fa27b` header 및 같은 session_info 이름; 적용 직전 재확인 필요 |

첫 두 프로세스의 UTC 시작 시각은 각각 08:18:41.6350330,
08:19:09.2076420이다. 적용 직전 PID와 시작 시각, 대화의 대기 상태,
세션 및 cwd를 다시 확인한다. PID를 오래된 값으로만 지정해 조작하지 않는다.

## Pilot의 정확한 재개 명령

승인 뒤 OBS 대화가 안전한 입력 대기임을 확인하고 해당 대화에서 정상
`/quit`를 처리한 뒤, **그 pane의 PowerShell prompt**에서 아래를 실행한다.
현재 구현 과정에서는 이 명령을 실행하지 않았다.

```powershell
& 'C:\Users\USER\.omo-stable-500\omo.cmd' --extension 'C:\Users\USER\orca\projects\herdr-agent-sidebar-diagnosis\repair\herdr-senpi.mjs' --session 'C:\Users\USER\.omo-stable-500\home\.omo\agent\sessions\--C--Users-USER-orca-projects-기타 작업--\2026-10-10T14-35-03-056Z_01a1263d-2210-7215-991a-096e966c36fe.jsonl'
```

agent prompt로 unregistered CMD-wrapped pane에 주입하지 않는다.
자동화한다면 승인된 대상의 pane surface만 사용하며 명령 전체를 하나의
shell text로 전달한다. Herdr CLI의 top-level `--session`과 child CLI
옵션을 혼동하지 않는다.

## Pilot 완료 조건

1. 동일 session ID로 재개됐고 현재 cwd/대화 내용이 보존됨.
2. loaded paths에 candidate 한 개, builtin의 양보, 유효 owner 한 개.
3. `agent list`와 실제 왼쪽 목록에 동일 대화가 나타남.
4. 정상 상태 변화 및 무관한 Pi 종료 뒤에도 항목 유지.
5. 문제가 없을 때만 두 번째 대화 적용을 별도로 승인받음.

원래 대화의 작업을 대신 수행하거나 새 작업 계획을 재개하지 않는다.
Herdr daemon 재시작은 필요하지 않으며 승인 대상도 아니다.

## 원복

pilot 대화가 안전한 대기일 때 정상 종료한 뒤, 위 명령에서
`--extension`과 그 파일 인자만 빼고 같은 session 파일로 시작한다.
원복 후 stock loader와 세션 신원을 확인한다. 이미 native Pi 종료 기록이
남은 pane에서 stock 등록이 회복되지 않는 경우에는 원래 소실 결함이
다시 드러날 수 있으므로 별도 판단한다. 강제 등록으로 통과시키지 않는다.
격리 원복 테스트는 새 pane에서 stock으로 시작하는 경로를 검증했다.

## 검증 한계

검증 버전은 OMO 5.1.32 / Senpi 2026.10.12 / Herdr 0.9.3이다.
private factory가 변경되는 업그레이드에는 재검증이 필요하다. provider
호출, 실제 owner hot-migration, Herdr daemon restore는 수행하지 않았다.
실제 재개 명령은 확장 경로도 기록하므로 opted-in 재개에서 repair가 빠지지
않는다. 기존 대화 세 개의 live 복구는 아직 수행하지 않았다.
