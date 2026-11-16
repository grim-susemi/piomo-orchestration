# Hydrogen 도구 연결 관리형 수정

상태: 실사용 적용·검증 완료(2026-11-16). 이 저장소에서 관리형 패치와 재현 검사를 보존한다.

2026-11-16 동일 Hydrogen low 대조:
- 중계 경유 도구 없음 200, 최소 도구 1개 AUTO/required 모두 429.
- 설치 공식 빌더의 직접 Google 응답은 RESOURCE_EXHAUSTED, 상세 이유·RetryInfo 없음.
- 합성 요청에서 중계 system을 제외하고 도구 선언 유지: 200.
- 도구 선언을 제외하고 중계 system 유지: 429.

수정은 Hydrogen의 CCA 요청에서 OpenCodex가 자동 추가하는 선택적
tool-catalog 지침만 제외한다. 사용자 system, 메시지, 실제 도구 선언,
모델·추론·인증·안전 설정은 수정하지 않는다. 다른 모델은 유지한다.
Google 내부 거절 규칙이나 정확한 개별 문자열은 확인되지 않았다.
금지 내용을 재작성하거나 실패 요청을 반복하는 패치가 아니다.

## 적용·갱신

- `node patch.mjs --ocx-root <installed-opencodex> --check`
- `node patch.mjs --ocx-root <installed-opencodex> --apply`
- OpenCodex 2.100.3의 정확한 원본 해시를 요구하며, 원본 옆 백업 후
  원자 교체한다. 기존 프로세스의 로딩은 별도 정상 재시작 후 확인한다.
- `candidate.preload.mjs`는 격리 진단과 테스트 전용이다. 상시 서비스 등록 없음.
- 업데이트 시 원본 어댑터에서 같은 합성 도구 시나리오를 실행한다.
  공식판이 성공하면 패치를 은퇴한다. 실패하면 새 해시·앵커를 재도출한다.
  앵커 부재만으로 은퇴하거나 알 수 없는 원본에 자동 적용하지 않는다.

## 테스트

`OPENCODEX_ROOT`에 검사할 OpenCodex 패키지 루트를 지정하고
`bun test probe.test.mjs`를 실행한다. 후보 대조는
`bun --preload ./candidate.preload.mjs test probe.test.mjs`로 수행한다.
개인 설치 경로·연결 로그·계정 정보는 공개 소스에 포함하지 않는다.

보호 계약: Hydrogen의 사용자 지침·도구 보존과 다른 모델의 동작 불변.
회귀: 조건 누락 또는 모든 모델에 잘못 적용. 기존 요약 패치는 다른 경계라
이 계약을 검사하지 않는다. 실제 Google 연결과 quick 작업자 실행은
별도 실사용 검증이며 오프라인 테스트 통과로 대체하지 않는다.

실측 결과: 원본 회귀 시험 1/2 실패로 재현, 후보와 적용본은 2/2 통과.
공식 drain 재시작 뒤 새 프로세스의 health200을 확인했다.
원래 quick 역할은 Hydrogen low로 실제 read 도구 1회 후 완료했다.
서버의 해당 시각 Hydrogen low 응답은 200·sendCount1이었다.
58초 관측기는 기본60초 drain보다 짧아 시간초과했으나 이후 새 PID를 직접 확인했다.
재시작 로그의 Codex journal 경고와 kimi-code 모델 검색401은 별도 기존 항목으로 보존했다.
