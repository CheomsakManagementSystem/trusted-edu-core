# 첨삭닷컴 develop 브랜치 개선 내역

- 작성일: 2026-08-06
- 대상 저장소: `CheomsakManagementSystem/trusted-edu-core`
- 대상 브랜치: `develop`
- 적용 범위:
  - 반 배정 및 기존 회원 문서 식별
  - 미연결 리포트 연결
  - 기존 반 가입 신청 승인
  - PDF 첨삭표 점수 파싱 정확도
  - 관리자 업로드 화면 성능
  - Firebase Performance 기반 KPI 계측
  - 관련 테스트 및 CI 검증

---

## 1. 작업 개요

이번 작업은 다음 운영 문제를 해결하기 위해 진행했다.

1. 관리자가 학생을 반에 배정해도 일부 기존 회원은 새로고침 후 반 배정이 사라지는 문제
2. 반 배정 불일치로 인해 PDF 리포트 자동 연결이 실패하는 문제
3. 미연결 리포트를 수동으로 연결해도 원래 반에서 조회되지 않는 문제
4. 기존 가입 회원의 반 가입 신청 승인 시 잘못된 사용자 문서가 수정될 수 있는 문제
5. PDF에서 평가 점수, 평균 점수, 환산 점수가 잘못 추출되는 문제
6. 학생 검색, 미연결 리포트 조회, 반복 렌더링으로 관리자 화면 CPU 사용량이 증가하는 문제
7. 개선 전후 속도를 객관적으로 비교할 계측 기준이 부족한 문제

기존 기능의 목적과 업무 흐름은 유지하면서 Firestore 문서 식별, 리포트 연결, PDF 파싱, 화면 연산 및 구독 구조를 보강했다.

---

## 2. 병합 이력

### 2.1 KPI 성능 계측

- PR: `#2 feat: add KPI performance instrumentation`
- 병합 커밋: `2ea2b25f68fe0eb5a26260f9e2f1ab0d00ea9019`
- 주요 내용:
  - Firebase Performance custom trace 추가
  - 관리자·학생 주요 조회, PDF 분석, 리포트 배포 시간 계측
  - 성능 측정 가이드 및 CI 검증 추가

### 2.2 반 배정 및 미연결 리포트 개선

- PR: `#4 fix: repair class assignment and pending report linking`
- 병합 커밋: `d55fefb8e20ac8dcb666372be8c0ee7b06fceaee`
- 주요 내용:
  - Firestore 실제 Document ID와 Firebase Auth UID 분리
  - 반 배정 후 서버 재조회 검증
  - 미연결 리포트의 원래 반 유지
  - 학생 반 추가와 리포트 연결을 하나의 batch로 처리

### 2.3 PDF 점수 파싱 및 기존 가입 승인 개선

- PR: `#5 fix: improve PDF score parsing accuracy`
- 병합 커밋: `782a329d8cdce1ce32ca7cc24e81be36a88f28f5`
- 주요 내용:
  - 기존 가입 신청 승인 시 실제 학생 문서 탐색
  - PDF 좌표 기반 점수표 파싱
  - 점수 범위·누락·총점 검증
  - 낮은 신뢰도 결과 자동 완료 차단

### 2.4 관리자 업로드 화면 CPU 및 응답 속도 개선

- 커밋: `18ed89272ca0075f339c5dda944741e8cdf8c28f`
- 커밋 메시지: `CPU 속도 및 에러 해결`
- 주요 내용:
  - 학생 검색용 문자열 사전 생성
  - 검색 후보 최대 50명 제한
  - 반복 정렬·필터링 메모이제이션
  - 콜백과 effect 의존성 안정화
  - 미연결 리포트 실시간 구독
  - 최근 반 리포트 20건 렌더링

---

# 3. 반 배정 문제 개선

## 3.1 기존 문제

일부 기존 회원은 Firestore 문서 ID와 Firebase Auth UID가 다르게 저장되어 있었다.

```text
users/{customDocumentId}
  uid: {firebaseAuthUid}
```

기존 코드가 다음처럼 `uid`를 Firestore 문서 ID로 사용하면 실제 학생 문서가 아닌 `users/{uid}`를 수정할 수 있었다.

```ts
doc(db, "users", student.uid)
```

이로 인해 다음 증상이 발생할 수 있었다.

- 실제 학생 문서의 `classIds`가 변경되지 않음
- 역할 없는 별도 사용자 문서가 생성되거나 수정됨
- 화면에서는 성공으로 보이지만 새로고침 후 반 배정이 사라짐
- PDF 리포트 자동 매칭 실패

## 3.2 학생 식별 계약 분리

```ts
type StudentLite = {
  docId: string;      // Firestore users 문서의 실제 Document ID
  uid: string;        // Firebase Authentication UID
  studentId: string | null;
  classIds: string[];
};
```

| 필드 | 사용 목적 |
|---|---|
| `docId` | `users/{docId}` 문서 읽기·수정 |
| `uid` | 로그인 사용자와 리포트 소유자 연결 |
| `studentId` | 학번 또는 내부 학생 코드 |
| `classIds` | 학생 소속 반 목록 |

학생 조회 시 `docSnap.id`를 보존하도록 변경했다.

```ts
return {
  docId: docSnap.id,
  uid: data.uid ?? docSnap.id,
  ...
};
```

## 3.3 실제 문서 기준 쓰기

다음 경로는 모두 실제 `docId`를 사용하도록 변경했다.

```ts
doc(db, "users", student.docId)
```

적용 대상:

- 관리자 단일 반 배정
- 관리자 일괄 반 배정
- 기존 반에서 학생 제외
- 학생 계정 반 변경
- 미연결 리포트 연결 중 학생 반 추가
- 신규 반 가입 신청
- 기존 반 가입 신청 승인

## 3.4 저장 후 서버 검증

반 배정 후 `getDocFromServer()`로 실제 서버 문서를 다시 읽어 요청한 반이 `classIds`에 저장됐는지 확인한다.

```text
반 배정 요청
→ Firestore batch commit
→ users/{docId} 서버 재조회
→ classIds 포함 여부 확인
→ 성공 메시지 표시
```

검증에 실패하면 성공으로 처리하지 않는다.

## 3.5 대량 배정 보호

Firestore batch write 한도를 넘지 않도록 최대 450명 단위로 나누어 처리한다.

## 3.6 재학 상태 판정 수정

기존:

```ts
remainingCount <= 1
```

수정:

```ts
remainingCount === 0
```

마지막 반에서 제외된 경우에만 `isEnrolled=false`가 된다.

---

# 4. 미연결 리포트 연결 개선

## 4.1 원래 리포트 반 유지

수동 연결 시 학생의 첫 번째 반으로 덮어쓰지 않고 리포트가 기존에 가지고 있던 `classId`, `className`을 우선 사용한다.

```text
리포트에 classId 존재
→ 기존 리포트 반 유지

리포트에 classId 없음
→ 학생 기본 반을 fallback으로 사용
```

## 4.2 학생 반 추가와 리포트 연결 원자화

학생이 리포트 반에 소속되지 않은 경우 다음 작업을 하나의 Firestore batch로 처리한다.

1. 실제 학생 문서의 `classIds`에 리포트 반 추가
2. 리포트에 학생 `uid`, 이름, 학생 코드를 연결하고 완료 상태로 변경

부분 성공 상태를 방지한다.

## 4.3 연결 후 반 검증

학생에게 반을 추가한 경우 batch commit 후 실제 학생 문서를 다시 읽어 해당 반이 저장됐는지 확인한다.

## 4.4 학생 조회 오류 노출

학생 조회 실패를 빈 배열로 숨기던 코드를 제거했다.

기존:

```ts
catch {
  return [];
}
```

개선 후에는 Firestore 오류를 상위 화면으로 전달하여 실제 학생 없음과 조회 실패를 구분한다.

---

# 5. 기존 반 가입 신청 승인 개선

## 5.1 기존 문제

기존 승인 함수는 신청서의 `studentUid`를 Firestore 문서 ID로 직접 사용했다.

```ts
doc(db, "users", requestData.studentUid)
```

실제 문서 ID와 Auth UID가 다른 기존 회원은 잘못된 문서가 수정될 수 있었다.

## 5.2 신규 신청 구조

```ts
studentDocId?: string | null;
studentUid: string;
```

## 5.3 기존 신청 하위 호환

기존 신청서에 `studentDocId`가 없는 경우 다음 순서로 실제 학생 문서를 찾는다.

```text
1. studentDocId 확인
2. 해당 문서가 student/STUDENT 역할인지 확인
3. 없으면 users에서 uid == studentUid 조회
4. 실제 학생 문서의 docId 선택
5. 실제 문서에 반 배정
```

역할 없는 `users/{uid}` 문서는 승인 대상으로 사용하지 않는다.

## 5.4 승인 batch 처리

학생 반 배정과 가입 신청 상태 변경을 하나의 batch에서 처리하여 부분 성공을 방지한다.

---

# 6. PDF 점수 파싱 정확도 개선

## 6.1 기존 문제

기존 fallback은 항목 구간의 숫자를 모두 찾은 뒤 마지막 숫자 3개를 점수로 선택했다.

```ts
const lastThree = values.slice(-3);
```

다음 값이 점수로 오인될 수 있었다.

- `(20점 만점)`의 20
- 날짜와 연도
- 페이지 번호
- 학생번호 또는 전화번호
- 다음 평가 항목 점수
- 총점

## 6.2 좌표 기반 표 파싱

PDF.js 텍스트 토큰의 위치 정보를 사용한다.

```ts
type PageToken = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
```

파싱 순서:

```text
1. 헤더 열 좌표 탐지
2. 평가 항목 행 좌표 탐지
3. 같은 행의 각 열 숫자 선택
4. 열을 찾지 못한 경우 순서 기반 fallback
5. 좌표 정보가 부족하면 낮은 신뢰도 text fallback
```

## 6.3 분리 토큰 인식

다음처럼 분리된 헤더와 항목명을 인접 좌표 기준으로 조합한다.

```text
"나의" + "점수"
"전체" + "평균"
"환산" + "점수"
"내용" + "이해력"
"문제" + "이해" + "력"
```

## 6.4 지원 평가 항목

| PDF 항목 | 내부 필드 |
|---|---|
| 독해력 | `reading` |
| 내용 이해력 | `comprehension` |
| 문제 이해력 | `problemUnderstanding` |
| 구성력 | `organization` |
| 표현력 | `expression` |

## 6.5 숫자 오인식 방지

- `20점 만점` 표현의 숫자를 점수 후보에서 제외
- 열 좌표 밖의 날짜·페이지·코드 제외
- 순서 기반 fallback에서도 만점 문구 제거 후 앞의 3개 숫자만 사용
- 파일명의 임의 숫자를 총점으로 사용하지 않음

파일명 총점은 다음처럼 명시적인 경우에만 허용한다.

```text
홍길동_총점65.pdf
홍길동_점수65.pdf
홍길동_65점.pdf
```

## 6.6 점수 검증

다음 검증을 수행한다.

- 필수 5개 점수 존재 여부
- 각 항목 점수가 0 이상인지
- 해당 행의 만점을 초과하지 않는지
- 총점이 나의 점수 합계 또는 환산 점수 합계와 일치하는지
- 낮은 신뢰도 자동 파싱인지

## 6.7 파싱 신뢰도

```ts
type ScoreParseMeta = {
  confidence: "high" | "medium" | "low" | "manual";
  method:
    | "layout-columns"
    | "layout-order"
    | "text-fallback"
    | "manual";
  warnings: string[];
};
```

| 신뢰도 | 의미 |
|---|---|
| `high` | 헤더와 행 좌표를 확인해 열 기준으로 파싱 |
| `medium` | 행 위치와 숫자 순서로 파싱 |
| `low` | 텍스트 fallback 또는 범위 오류 발생 |
| `manual` | 관리자가 직접 확인·수정 |

`low` 결과는 숫자가 존재해도 자동 완료하지 않는다. 관리자가 점수를 수정하면 `manual` 상태로 기록한다.

---

# 7. 관리자 업로드 화면 속도 개선

## 7.1 학생 검색 문자열 사전 생성

기존에는 입력할 때마다 모든 학생의 이름, 이메일, 학생 코드, 연락처, 반 이름을 문자열로 다시 조합했다.

개선 후 학생 목록이 변경될 때만 검색 문자열을 생성한다.

```ts
type SearchableStudent = StudentLite & {
  searchText: string;
};

const searchableStudents = useMemo(
  () =>
    [...students]
      .sort((a, b) => a.name.localeCompare(b.name, "ko"))
      .map((student) => ({
        ...student,
        searchText: `${student.name} ${student.email} ${student.studentId ?? ""} ${student.phoneSuffix ?? ""} ${student.phoneNumber ?? ""} ${student.className ?? ""}`.toLowerCase(),
      })),
  [students],
);
```

## 7.2 검색 결과 50명 제한

```ts
const filterStudents = useCallback(
  (keyword: string) => {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) return [];

    return searchableStudents
      .filter((student) => student.searchText.includes(normalized))
      .slice(0, 50);
  },
  [searchableStudents],
);
```

효과:

- 대규모 학생 목록 전체 렌더링 방지
- 입력 시 DOM 생성량 감소
- 모바일 브라우저 렌더링 부하 감소

## 7.3 반복 연산 메모이제이션

다음 연산을 `useMemo` 또는 `useCallback`으로 고정했다.

- 학생 검색 인덱스
- 검색 결과
- 업로드 후보 매칭 계산
- 최근 반 리포트 정렬
- pending·fix 후보 목록

## 7.4 effect 및 Firestore listener 안정화

`toast` 등 렌더링마다 참조가 달라질 수 있는 값을 `useRef`로 보관하여 Firestore listener가 불필요하게 재등록되지 않도록 변경했다.

```ts
const toastRef = useRef(toast);

useEffect(() => {
  toastRef.current = toast;
}, [toast]);
```

구독 effect는 안정된 의존성으로 한 번만 등록하고 unmount 시 해제한다.

## 7.5 미연결 리포트 실시간 구독

단발성 전체 조회 대신 Firestore `onSnapshot` 구독으로 변경했다.

```ts
const pendingQuery = query(
  collection(db, "reports"),
  where("assignmentStatus", "in", ["duplicate_pending", "unassigned_pending"]),
);
```

효과:

- 화면 진입 후 반복 전체 조회 감소
- 미연결 리포트 변경 즉시 반영
- 조회 오류를 관리자에게 표시

## 7.6 초기 데이터 병렬 조회

반 목록과 학생 목록은 서로 의존하지 않으므로 병렬 조회한다.

```ts
const [classDocs, studentDocs] = await Promise.all([
  fetchClasses(),
  fetchStudents(),
]);
```

## 7.7 최근 리포트 렌더링 제한

관리자 기본 화면에서는 최근 반 리포트 20건만 렌더링한다.

```ts
const recentClassReports = useMemo(
  () => [...classReports]
    .sort(compareReportsByExamDateDesc)
    .slice(0, 20),
  [classReports],
);
```

전체 데이터는 보관하되 초기 화면의 DOM 생성량을 제한한다.

---

# 8. Firebase Performance KPI 계측

## 8.1 활성화 조건

```env
VITE_PERFORMANCE_ENABLED=true
VITE_PERFORMANCE_BUILD_LABEL=perf_fix_YYYYMMDD
```

계측을 중단하려면 `VITE_PERFORMANCE_ENABLED=false`로 배포한다.

## 8.2 비차단 구조

Firebase Performance 모듈은 동적으로 로딩하며 계측 초기화 또는 기록 실패가 사용자 기능에 영향을 주지 않도록 예외를 무시한다.

```ts
try {
  measurement.record(...);
} catch {
  // 계측 실패가 업무 흐름에 영향을 주지 않도록 무시
}
```

## 8.3 수집 trace

| trace | 측정 범위 |
|---|---|
| `admin_base_load` | 관리자 반·학생 최초 조회 |
| `admin_pending_load` | 미연결 리포트 최초 수신 |
| `admin_published_load` | 배포 리포트 최초 조회 |
| `admin_class_reports_load` | 선택 반 리포트 조회 |
| `class_manager_load` | 반 관리 데이터 조회 |
| `master_admin_load` | 최고 관리자 데이터 조회 |
| `student_reports_load` | 학생 리포트 최초 수신 |
| `pdf_parse_batch` | PDF 해시·분석 처리 |
| `report_publish_batch` | 리포트 배포 전체 처리 |

모든 trace에는 다음 정보가 포함된다.

- `build`
- `status`: `success`, `partial`, `error`, `cancelled`
- 대상별 건수 metric

학생 이름, 이메일, UID, 파일명 등 식별정보는 기록하지 않는다.

## 8.4 비교 기준

- trace별 최소 30회, 권장 100회 이상
- 평균과 함께 p50, p95 비교
- 기준 버전과 개선 버전의 시간대·파일 수를 유사하게 유지
- 속도가 빨라져도 오류율이 증가하면 개선 성공으로 판정하지 않음

```text
처리 시간 개선율 = (기준 시간 - 개선 후 시간) / 기준 시간 × 100
오류율 = error trace 수 / 전체 trace 수 × 100
PDF 인식 실패율 = parse_failure_count / file_count × 100
배포 성공률 = success_count / (success_count + pending_count + failure_count) × 100
파일당 처리 시간 = trace duration / file_count
```

---

# 9. 변경 파일

## KPI 및 성능 계측

- `.github/workflows/kpi-validation.yml`
- `PERFORMANCE_MEASUREMENT_GUIDE.md`
- `package.json`
- `src/lib/performanceMonitoring.ts`
- `src/lib/performanceMonitoring.test.ts`
- `src/main.tsx`
- `src/pages/Admin/ClassManager.tsx`
- `src/pages/Admin/MasterAdminPage.tsx`
- `src/pages/Admin/UploadDashboard.tsx`
- `src/pages/Student/ReportView.tsx`

## 반 배정 및 리포트 연결

- `src/lib/pdfProcessor.ts`
- `src/lib/pdfProcessor.test.ts`
- `src/pages/Admin/ClassManager.tsx`
- `src/pages/Admin/UploadDashboard.tsx`
- `src/pages/Student/AccountSettings.tsx`
- `src/services/classTransferService.ts`
- `src/services/classTransferService.test.ts`

## PDF 파싱 및 가입 승인

- `src/lib/pdfProcessor.ts`
- `src/lib/pdfProcessor.test.ts`
- `src/pages/Admin/UploadDashboard.tsx`

---

# 10. 테스트 및 검증 결과

수행 항목:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

결과:

- TypeScript typecheck 통과
- Vitest 테스트 통과
- Vite production build 통과
- GitHub Actions 최종 브랜치 상태 검증 통과

주요 회귀 테스트:

- Firestore custom Document ID 회원 반 배정
- 일반 UID 문서 회원 반 배정
- 혼합 일괄 배정
- 마지막 반 제외 시 재학 상태 변경
- 리포트 원래 반 유지
- 분리된 PDF 헤더·평가 항목 인식
- 만점 숫자와 날짜 등 불필요 숫자 제외
- 만점 초과 점수 차단
- 총점 불일치 차단
- 낮은 신뢰도 결과 직접 확인 요구

---

# 11. 변경 전후 비교

| 항목 | 변경 전 | 변경 후 |
|---|---|---|
| 학생 문서 쓰기 | Auth UID를 문서 ID로 사용할 수 있음 | 실제 `docId` 사용 |
| 반 배정 확인 | write 성공만 확인 | 서버 재조회로 `classIds` 검증 |
| 일괄 배정 | 500 write 한도 위험 | 450명 단위 chunk |
| 미연결 리포트 반 | 학생 첫 반으로 덮어쓸 수 있음 | 리포트 원래 반 우선 |
| 학생 반 추가와 연결 | 부분 성공 가능 | 하나의 batch 처리 |
| 가입 승인 | `users/{studentUid}` 직접 수정 | 실제 학생 문서 탐색 |
| PDF 점수 추출 | 구간 마지막 숫자 3개 | 열 좌표 기반 추출 |
| 불확실한 점수 | 자동 완료 가능 | 관리자 직접 확인 |
| 학생 검색 | 입력마다 문자열 재조합·전체 필터 | 사전 인덱스·50명 제한 |
| listener | 참조 변경 시 재등록 가능 | 안정된 effect로 1회 구독 |
| 반 리포트 렌더링 | 전체 목록 기본 렌더링 | 최근 20건 렌더링 |
| 성능 확인 | 체감 중심 | Firebase trace p50·p95 비교 |

---

# 12. 운영 확인 절차

## 12.1 기존 회원 반 배정

1. Firestore Document ID와 내부 UID가 다른 기존 학생 선택
2. 관리자 반 관리에서 반 배정
3. 새로고침
4. 학생이 해당 반에 유지되는지 확인
5. 실제 원본 문서의 `classIds` 확인
6. `users/{uid}` 별도 문서가 생성되지 않았는지 확인

## 12.2 미연결 리포트

1. 리포트 반에 소속되지 않은 학생에게 수동 연결
2. 실제 학생 문서에 반이 추가되는지 확인
3. 리포트의 기존 `classId`가 유지되는지 확인
4. 해당 반 리포트 목록과 학생 계정에서 조회되는지 확인

## 12.3 기존 가입 신청 승인

1. `studentDocId`가 없는 기존 신청 승인
2. 실제 학생 원본 문서에 반이 추가되는지 확인
3. 신청 상태가 `approved`인지 확인
4. 역할 없는 `users/{uid}` 문서가 수정되지 않았는지 확인

## 12.4 PDF 점수 파싱

서로 다른 첨삭표 양식으로 다음 값을 확인한다.

- 학생 이름
- 수강반
- 독해력
- 내용 이해력
- 문제 이해력
- 구성력
- 표현력
- 전체 평균
- 환산 점수
- 총점

특히 헤더와 항목명이 여러 토큰으로 분리되는 PDF, 소수점 평균이 있는 PDF, 날짜·페이지 번호가 점수표 근처에 있는 PDF를 포함한다.

## 12.5 속도 및 KPI

1. `VITE_PERFORMANCE_ENABLED=true`로 스테이징 배포
2. 기준·개선 버전에 서로 다른 build label 지정
3. 관리자 업로드, 반 선택, 학생 검색, PDF 분석, 리포트 배포 수행
4. Firebase Console의 Custom traces 수신 확인
5. 각 trace의 p50, p95, 오류율 비교
6. Chrome Performance 도구로 입력 지연과 렌더링 횟수 확인

---

# 13. 이번 작업에 포함되지 않은 항목

## 13.1 기존 유령 사용자 문서 정리

새로운 유령 문서가 생성되는 경로는 차단했지만 기존 유령 문서를 자동 병합하거나 삭제하지 않았다. 원본과 유령 문서의 `classIds`가 충돌할 수 있으므로 별도 dry-run, 백업, 관리자 검토 후 migration해야 한다.

## 13.2 Firestore Security Rules

운영 Rules는 이번 작업에서 변경하지 않았다. 관리자·강사·학생 권한, 학생의 직접 반 변경 허용 여부, 수정 가능한 필드, tenant 분리 정책을 확정한 후 Emulator 검증이 필요하다.

## 13.3 운영 PDF 정확도 상승률

실제 오인식 PDF와 정답셋이 제공되지 않아 정확도 상승률을 수치로 산정하지 않았다. 현재 검증은 코드상 오인식 경로 제거와 가상 PDF 토큰 회귀 테스트 기준이다.

## 13.4 실제 운영 속도 개선율

성능 개선 코드는 반영되어 있지만 운영 트래픽 기준 p50·p95 비교값은 아직 수집 전이다. Firebase Performance trace를 일정 기간 수집한 후 개선율을 계산해야 한다.

---

# 14. 권장 후속 작업

1. 운영 PDF 20~50건으로 정답셋 구축
2. 기존 사용자 유령 문서 dry-run 진단 및 백업
3. Firestore Emulator 기반 Rules 테스트
4. 스테이징 기준 성능 trace 최소 30회 이상 수집
5. 기준·개선 버전 p50·p95 및 오류율 비교
6. 학생 수가 많은 반에서 검색 입력 지연과 DOM 노드 수 확인
7. 최근 20건 외 전체 리포트 조회가 필요한 경우 페이지네이션 도입

---

# 15. 최종 상태

현재 `develop` 브랜치에는 다음 개선이 반영되어 있다.

- 실제 Firestore 학생 문서 ID 기반 반 배정
- 기존 회원 반 변경 및 가입 승인 지원
- 저장 후 서버 검증
- 대량 반 배정 chunk 처리
- 미연결 리포트 원래 반 유지
- 학생 반 추가와 리포트 연결 batch 처리
- 분리된 PDF 토큰 기반 표 파싱
- 점수 열 좌표 기반 추출
- 점수 범위·누락·총점 검증
- 낮은 신뢰도 결과 자동 완료 차단
- 학생 검색 메모이제이션 및 50명 제한
- Firestore listener 안정화
- 최근 리포트 20건 렌더링
- Firebase Performance custom trace 및 KPI 비교 체계
- 관련 단위 테스트와 프로덕션 빌드 검증

운영 데이터 정리, 실제 PDF 정답셋 기반 정확도 측정, 운영 성능 p50·p95 수집은 별도 후속 작업으로 남아 있다.
