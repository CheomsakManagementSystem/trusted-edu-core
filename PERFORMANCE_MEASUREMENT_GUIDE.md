# 첨삭닷컴 KPI 성능 계측 가이드

## 목적

기존 기능·권한·Firestore 구조·화면 흐름은 변경하지 않고 Firebase Performance Monitoring으로 주요 업무의 처리 시간을 수집한다. 계측 실패는 사용자 기능에 영향을 주지 않는다.

## 배포 환경변수

```env
VITE_PERFORMANCE_ENABLED=true
VITE_PERFORMANCE_BUILD_LABEL=baseline_20260805
```

성능 개선 버전은 서로 다른 라벨을 사용한다.

```env
VITE_PERFORMANCE_BUILD_LABEL=perf_fix_YYYYMMDD
```

계측을 중지하려면 `VITE_PERFORMANCE_ENABLED=false`로 빌드·배포한다.

## 수집 trace

| trace | 측정 범위 | 주요 metric |
|---|---|---|
| `admin_base_load` | 관리자 반·학생 최초 조회 | `class_count`, `student_count` |
| `admin_pending_load` | 미연결 리포트 최초 수신 | `report_count` |
| `admin_published_load` | 배포 리포트 최초 조회 | `report_count` |
| `admin_published_search` | 보관함 검색·필터·페이지 결과가 화면에 반영될 때까지 | `query_length`, `result_count`, `rendered_count`, `total_count` |
| `admin_class_reports_load` | 선택 반 리포트 조회 | `report_count` |
| `class_manager_load` | 반 관리 데이터 조회 | `class_count`, `student_count` |
| `master_admin_load` | 최고 관리자 데이터 조회 | `user_count` |
| `student_reports_load` | 학생 리포트 최초 수신 | `report_count` |
| `pdf_parse_batch` | PDF 해시·분석 처리 | `file_count`, `parse_failure_count` |
| `report_publish_batch` | 리포트 배포 전체 처리 | `file_count`, `success_count`, `pending_count`, `failure_count` |

모든 trace에는 `build`와 `status(success/partial/error/cancelled)` 속성이 기록된다. `admin_published_search`에는 검색 종류를 구분하는 `trigger(keyword/class/read/page)`와 선택한 필터 종류만 추가된다. 학생 이름, 검색어, 이메일, UID, 반 이름, 파일명 등 식별정보는 기록하지 않는다.

## 배포 전 검증

```bash
npm ci
npm run typecheck
npm test
npm run build
```

## 전송 확인

1. 배포 후 Chrome 개발자 도구의 Network 탭을 연다.
2. `firebaselogging.googleapis.com`으로 필터링한다.
3. 관리자·학생 주요 화면을 열고 PDF 분석과 테스트 리포트 배포를 각각 한 번 수행한다.
4. Firebase Console → Performance Monitoring → Custom traces에서 위 trace를 확인한다.

## KPI 비교 기준

- 각 trace 최소 30회, 권장 100회 이상 수집
- 평균보다 p50과 p95를 함께 비교
- 기준·개선 버전의 기간, 시간대, 처리 파일 수를 유사하게 유지
- 속도가 빨라져도 `error`, `partial`, `failure_count`, `parse_failure_count`가 증가하면 성공으로 판정하지 않음

```text
처리 시간 개선율(%) = (기준 시간 - 개선 후 시간) / 기준 시간 × 100
오류율(%) = status=error 건수 / 전체 trace 건수 × 100
PDF 인식 실패율(%) = parse_failure_count 합계 / file_count 합계 × 100
배포 성공률(%) = success_count / (success_count + pending_count + failure_count) × 100
파일당 처리 시간 = trace duration / file_count
검색 결과 1건당 렌더링 비율 = rendered_count / result_count
```
