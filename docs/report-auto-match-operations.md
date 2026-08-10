# 미연결 리포트 자동 매칭 운영 기준

## 실행

- 함수: `autoMatchPendingReports`
- 일정: 매일 오전 2시 (`Asia/Seoul`)
- 대상: `assignmentStatus == "unassigned_pending"`이면서 학생 식별값이 비어 있는 리포트
- 최초 배포 후 Cloud Scheduler에서 작업을 한 번 수동 실행하면 기존 대기 건도 즉시 처리할 수 있다.

배포 명령:

```bash
firebase deploy --only functions:autoMatchPendingReports
```

Cloud Scheduler를 사용하므로 Firebase 프로젝트가 Blaze 요금제이고 Cloud Scheduler API가 활성화되어 있어야 한다. 별도 Firestore 인덱스나 보안 규칙 변경은 필요하지 않다.

## 자동 연결 조건

1. 리포트의 `classId`를 우선 사용한다.
2. `classId`가 없을 때만 정규화된 반 이름이 정확히 한 반과 일치하는지 확인한다.
3. 해당 반에 소속된 학생 중 정규화된 이름이 정확히 한 명이면 연결한다.
4. 같은 반에 동명이인이 있으면 학생 고유 ID, 전화번호 뒤 4자리 순으로 한 명이 확정될 때만 연결한다.
5. 반·이름·보조 식별값으로 한 명을 확정하지 못하면 미연결 상태를 유지한다.

`duplicate_pending`은 자동 처리하지 않으며, 자동 매칭 과정에서 학생의 반 소속을 추가하거나 변경하지 않는다.

## 동시 실행과 수동 처리 보호

- 10분짜리 실행 잠금으로 스케줄 중복 호출을 막는다.
- 각 연결 직전에 리포트와 학생을 트랜잭션으로 다시 읽는다.
- 관리자가 먼저 연결했거나 학생의 반·이름 정보가 바뀌면 자동 쓰기를 취소한다.

## 실행 KPI

실행별 결과는 `report_auto_match_runs/{runId}`에 저장하고 Cloud Functions 로그에도 남긴다.

- `pendingCount`: 조회한 미연결 리포트 수
- `matchCandidateCount`: 안전한 자동 연결 후보 수
- `matchedCount`: 실제 연결 완료 수
- `staleCount`: 수동 처리나 데이터 변경으로 쓰기를 취소한 수
- `errorCount`: 쓰기 실패 수
- `unmatched`: 이름 없음, 반 없음, 반 중복, 학생 없음, 동명이인 건수
- `durationMs`: 전체 실행 소요 시간

KPI에는 학생 이름, 전화번호, 학생 ID를 기록하지 않는다.
