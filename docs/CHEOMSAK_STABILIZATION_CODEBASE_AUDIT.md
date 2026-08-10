# CHEOMSAK 안정화 코드베이스 감사

감사 기준: 현재 체크아웃의 정적 코드. 배포 상태, 실제 Secret, 실사용 데이터는 확인하지 않았다. 따라서 저장소 코드로 증명할 수 없는 항목은 `NEEDS_RUNTIME_VERIFICATION(런타임검증필요)`로 제한한다.

## 1. Executive Verdict

현재 코드는 PDF 점수표 방어 로직, 리포트 식별자 병합 조회, 성능 trace의 일부 등 안정화 조각을 포함하지만 목표상태의 핵심 경계인 서버 주도 회원가입은 도달하지 못했다. `Signup.handleSubmit`이 role 판정, 4자리 ID 중복 조회, `users/{uid}` 생성을 모두 클라이언트에서 수행한다(`src/pages/Signup.tsx:L39-L83`). Functions에는 `completeSignupProfile`이 없고 인증 없는 Auth 삭제 HTTP handler만 있다(`functions/index.js:L39-L97`). 특히 현재 rules는 `users` create를 전면 금지한다(`firestore.rules:L44-L50`). 저장소 설정 그대로 배포돼 있다면 현재 회원가입은 Auth 생성 뒤 Firestore write에서 실패하여 고아 Auth를 만든다.

26개 목표 판정은 완료 1, 부분구현 11, 미구현 7, 구현되었으나 미사용 1, 레거시에 막힘 3, 런타임 검증 필요 3이다. P0는 회원가입 권한·Secret·ID 원자성, 무인증 관리자 삭제 Function, 삭제 순서/리포트 소유권이다. P1은 class 대표반 정합성, 점수 canonicalization, production PDF 경로 통합, query/index/listener 정리다.

## 2. Current Architecture Map

| 경계 | 실제 호출 chain | 책임과 판정 |
|---|---|---|
| 회원가입 | `Signup.handleSubmit` → `getMasterControls` → client role 비교 → `users.phoneSuffix` query → Auth create → `setDoc(users/{uid})` | `src/pages/Signup.tsx:L39-L95`에서 서버 검증·transaction·보상 삭제가 없다. 목표 flow와 핵심적으로 불일치한다. |
| 로그인 | `Login.handleSubmit` → Auth sign-in → `getDoc(users/{uid})` → redirect; 동시에 `AuthProvider` → direct `getDoc` → `onSnapshot` | `src/pages/Login.tsx:L49-L73`, `src/contexts/AuthContext.tsx:L65-L170`. 같은 프로필을 로그인 화면과 provider가 중복 조회한다. |
| custom-ID profile | direct `users/{uid}` 실패 → `where(uid==auth.uid), limit(1)` → resolved doc listener | `src/contexts/AuthContext.tsx:L68-L107`. 호환 resolver는 있으나 예외를 모두 삼키고 재귀 재구독한다. |
| 반 관리 | ClassManager가 classes/users를 직접 query하고 각 user를 개별 update | rename은 모든 membership 학생의 `className`을 덮고(`src/pages/Admin/ClassManager.tsx:L268-L296`), delete는 새 대표반 이름을 null로 둔다(`src/pages/Admin/ClassManager.tsx:L316-L345`). |
| 계정 삭제 | client Firestore purge → client/current Auth delete 또는 공개 HTTP Admin SDK delete | `src/services/accountDeletionService.ts:L172-L198`, `L209-L271`; 서버 handler는 caller token/role을 검증하지 않는다(`functions/index.js:L56-L78`). |
| 리포트 조회 | studentUid listener + studentId listener, index 오류 때 무정렬 listener | `src/pages/Student/ReportView.tsx:L110-L224`; 문서 ID로 merge/dedupe한다(`L137-L144`). |
| PDF production | UploadDashboard imports base `pdfProcessor` | 실제 imports는 `src/pages/Admin/UploadDashboard.tsx:L38-L62`; stable→hotfix→legacy 계층은 별도이나 UI가 사용하지 않는다(`src/lib/pdfProcessorStable.ts:L1-L9`, `src/lib/pdfProcessorHotfix.ts:L11-L21`). |
| 점수/추이 | 여러 local fallback + exam-date descending arrays | hydrate가 누락 total을 0으로 확정(`src/lib/pdfProcessor.ts:L314-L353`); 관리자 trend는 descending 배열의 끝 3개를 사용(`src/pages/Admin/MasterAdminPage.tsx:L318-L336`). |

## 3. Target-State Gap Matrix

| # | 목표 | 상태 | 근거 | 남은 작업 | 위험도 |
|---:|---|---|---|---|---|
| 1 | 로그인·프로필 중복조회 감소 | PARTIAL(부분구현) | provider는 listener 하나를 정리하지만(`src/contexts/AuthContext.tsx:L98-L100`, `L173-L178`), Login이 별도 `getDoc`을 한다(`src/pages/Login.tsx:L55-L65`). | redirect를 AuthContext의 resolved profile readiness에 결합 | P1 |
| 2 | custom-ID resolution 안정화 | PARTIAL(부분구현) | uid query fallback 존재(`src/contexts/AuthContext.tsx:L71-L90`), query 실패/네트워크 실패를 구분하지 않고 null 처리(`L80-L94`). | 단일 resolver, typed reason, retry 상한 | P1 |
| 3 | role 판정 서버 이전 | NOT_IMPLEMENTED(미구현) | role을 client secret 비교로 산출(`src/pages/Signup.tsx:L51-L58`). | Function에서 Secret 검증 후 canonical role write | P0 |
| 4 | `completeSignupProfile` 기반 전환 | NOT_IMPLEMENTED(미구현) | Functions export는 삭제 2개뿐(`functions/index.js:L96-L97`); Signup은 callable import가 없다(`src/pages/Signup.tsx:L1-L15`). | callable 구현·frontend 연결 | P0 |
| 5 | signup code 클라이언트 제거 | NOT_IMPLEMENTED(미구현) | master code literal과 instructor default literal이 bundle source에 존재(`src/services/masterAdminService.ts:L21-L25`), Signup이 읽고 비교(`src/pages/Signup.tsx:L51-L57`). | Secret Manager로 이전; client에는 입력값만 전달 | P0 |
| 6 | ID reservation transaction | NOT_IMPLEMENTED(미구현) | users query 후 create의 TOCTOU(`src/pages/Signup.tsx:L60-L75`); reservation/transaction symbol 없음. | 서버 transaction으로 reservation+user write | P0 |
| 7 | 실패시 Auth 고아 처리 | NOT_IMPLEMENTED(미구현) | Auth create 뒤 `setDoc` 실패 catch에 `credential.user.delete()`가 없음(`src/pages/Signup.tsx:L70-L118`). | callable idempotency와 client compensation/retry | P0 |
| 8 | 관리자/선생님 삭제시 학생 리포트 보존 | PARTIAL(부분구현) | student identity는 null 처리하지만 동시에 uploader `uid` reports를 삭제(`src/services/accountDeletionService.ts:L63-L80`, `L172-L180`). 동일 report가 두 작업에 병렬 포함될 수 있다. | role별 정책과 uploader 보존 invariant를 서버 batch로 분리 | P0 |
| 9 | 관리자 삭제 Function 서버권한 검증 | NOT_IMPLEMENTED(미구현) | GET/POST uid만으로 Admin SDK delete(`functions/index.js:L56-L78`); ID token/ADMIN 확인 없음. | callable/onRequest auth+role 검증, GET 제거 | P0 |
| 10 | class 필드 정합성 | LEGACY_BLOCKED(레거시에막힘) | normalization은 dual representation 수용(`src/services/classTransferService.ts:L45-L55`), 여러 write helper가 세 필드를 함께 쓰지만(`L246-L278`) ClassManager delete가 이름 null을 기록(`src/pages/Admin/ClassManager.tsx:L329-L340`). | canonical mutation service와 legacy read fallback | P1 |
| 11 | 대표/보조반 rename·delete | PARTIAL(부분구현) | rename이 대표 여부와 무관하게 className을 전부 변경(`src/pages/Admin/ClassManager.tsx:L280-L295`); delete는 nextIds[0] 선택 후 이름 null(`L325-L340`). | 대표반 조건부 rename, deterministic successor lookup | P1 |
| 12 | PDF score/average/converted 파싱 | PARTIAL(부분구현) | token table과 범위검증 존재(`src/lib/pdfProcessor.ts:L913-L1140`), hotfix/stable 복구도 존재(`src/lib/pdfProcessorHotfix.ts:L101-L170`, `src/lib/pdfProcessorStable.ts:L36-L113`). | production import 통합, fixture 확대 | P1 |
| 13 | PDF 배점 오인식 차단 | PARTIAL(부분구현) | `(20점 만점)` 제거 후 세 숫자 사용(`src/lib/pdfProcessor.ts:L585-L595`), stable도 동일(`src/lib/pdfProcessorStable.ts:L55-L73`). 다만 production이 base path이며 정확 패턴의 회귀 fixture는 stable test에만 간접 존재. | production parser에 golden fixture gate | P1 |
| 14 | totalScore fallback 일원화 | LEGACY_BLOCKED(레거시에막힘) | parser resolver와 화면 local resolver가 공존(`src/lib/pdfProcessor.ts:L1676-L1684`, `src/pages/Admin/MasterAdminPage.tsx:L55-L78`); hydrate는 missing을 0으로 소실(`src/lib/pdfProcessor.ts:L341-L350`). | canonical read utility에 명시 순서 구현 | P1 |
| 15 | 성적추이 chronological ordering | NOT_IMPLEMENTED(미구현) | desc 정렬 뒤 `totals.slice(-3)`은 최신 3개가 아니라 가장 오래된 3개이고 비교 방향도 반대(`src/pages/Admin/MasterAdminPage.tsx:L318-L336`). | desc에서 앞 3개 선택 후 reverse | P1 |
| 16 | 학생 그래프 시간축 | PARTIAL(부분구현) | reports가 desc 정렬되고(`src/pages/Student/ReportView.tsx:L127-L144`) trendData는 reverse 없이 그대로 전달(`L289-L298`). | chart 입력만 oldest→newest로 변환 | P1 |
| 17 | composite index 정합성 | PARTIAL(부분구현) | reports 4개, join requests 2개 index가 선언(`firestore.indexes.json:L2-L50`)되어 주요 equality+createdAt query와 맞는다. `createdTime` query는 별도 필드(`src/hooks/useStudentStats.ts:L25-L31`). | query inventory 고정 테스트와 배포 검증 | P1 |
| 18 | 관리자 pagination 준비 | NOT_IMPLEMENTED(미구현) | users 전체 fetch 후 client sort(`src/services/masterAdminService.ts:L91-L138`), ClassManager도 전체 users/classes 로드(`src/pages/Admin/ClassManager.tsx:L68-L72`). | cursor pagination과 검색 계약 설계 | P2 |
| 19 | identity fallback 최적화 | PARTIAL(부분구현) | uid와 studentId listener를 항상 병행하고 문서 ID dedupe(`src/pages/Student/ReportView.tsx:L137-L224`). | uid 결과/legacy marker 기반 조건부 fallback | P1 |
| 20 | 중복 listener/read 제거 | PARTIAL(부분구현) | listener cleanup은 존재(`src/pages/Student/ReportView.tsx:L226-L236`), 그러나 로그인 중복 read와 dual identity listeners가 남는다. | resolver/query ownership 단일화 | P1 |
| 21 | PDF.js dependency 안정화 | NEEDS_RUNTIME_VERIFICATION(런타임검증필요) | `pdfjs-dist`가 package dependency에 없지만 동적 candidate import를 시도(`src/lib/pdfProcessor.ts:L1295-L1325`); 실제 번들/runtime 성공은 정적으로 보장 못 한다. | direct dependency/worker 계약 및 build smoke | P1 |
| 22 | hotfix/stable 책임 | IMPLEMENTED_BUT_UNUSED(구현되었으나미사용) | stable은 hotfix를 감싸고 hotfix는 legacy를 감싼다(`src/lib/pdfProcessorStable.ts:L1-L9`, `src/lib/pdfProcessorHotfix.ts:L11-L21`), UI는 base만 import한다. | 단일 public facade 선택 후 중복 override 제거 | P1 |
| 23 | KPI/latency 계측 | PARTIAL(부분구현) | Firebase Performance lazy trace와 student report trace가 존재(`src/lib/performanceMonitoring.ts:L38-L102`, `src/pages/Student/ReportView.tsx:L117-L125`). signup/PDF/upload/delete KPI는 없다. | 주요 flow별 trace/reason dimensions | P2 |
| 24 | error reason/code 표준화 | PARTIAL(부분구현) | `AccountDeletionError`는 step/code를 갖지만(`src/services/accountDeletionService.ts:L23-L35`), Function/Signup/Login은 서로 다른 string mapping(`functions/index.js:L25-L35`, `src/pages/Signup.tsx:L28-L37`). | shared stable error taxonomy | P1 |
| 25 | legacy backward compatibility | LEGACY_BLOCKED(레거시에막힘) | studentId 추론(`src/contexts/AuthContext.tsx:L124-L131`), examDate fallback(`src/lib/pdfProcessor.ts:L314-L349`)은 있으나 missing total을 0으로 확정한다. | read-only fallback과 provenance, 신규 write 차단 | P1 |
| 26 | UI/업무흐름 회귀방지 | NEEDS_RUNTIME_VERIFICATION(런타임검증필요) | parser/performance unit test는 있으나 auth/class/delete/query flow test가 없다(`src/lib/pdfProcessor.test.ts:L1-L218`, `src/lib/performanceMonitoring.test.ts:L1-L35`). | emulator/integration/manual smoke gate | P1 |

## 4. Authentication & Login Audit

실제 B flow는 `signInWithEmailAndPassword` 직후 Login이 `users/{uid}`를 읽어 redirect role을 정하고(`src/pages/Login.tsx:L49-L73`), Auth 상태 변경을 받은 provider가 같은 direct doc을 다시 읽은 뒤 listener를 붙이는 구조다(`src/contexts/AuthContext.tsx:L68-L100`, `L158-L170`). destination은 provider loading을 다시 기다리므로 첫 화면까지 최소 Auth + Login read + provider read/listener의 중복 경계가 생긴다.

custom-ID 문서의 경우 Login은 direct doc만 보므로 존재하는 custom doc role도 STUDENT로 오인 redirect할 수 있다(`src/pages/Login.tsx:L58-L70`). Provider resolver는 `where(uid==...) limit(1)`로 뒤늦게 올바른 문서를 찾는다(`src/contexts/AuthContext.tsx:L71-L90`). snapshot에서 문서가 사라지면 동일 함수를 무제한 재호출할 수 있고(`L101-L107`), query permission/index/network 오류를 모두 동일한 null로 축약한다(`L80-L94`). 단일 `resolveUserProfileRef`가 direct/custom resolution, reason, retry policy를 소유하고 Login은 provider 결과만 소비해야 한다.

## 5. Signup / Role / Secret Audit

실제 A flow는 입력 → `getMasterControls` → client role 결정 → client 중복 query → Auth create → client `users/{uid}` write → redirect이다(`src/pages/Signup.tsx:L39-L95`). 목표 flow의 `completeSignupProfile`, Secret 검증, server role 결정, reservation transaction은 전부 없다. `MASTER_ADMIN_CODE`와 instructor default는 frontend source literal이며(`src/services/masterAdminService.ts:L21-L25`), instructor code 문서도 client가 읽는다(`L53-L72`). 이는 bundle 노출뿐 아니라 변조된 클라이언트가 role field를 직접 고를 수 있게 한다.

저장소 rules는 self user조차 create 불허이고 update도 `classIds`만 허용한다(`firestore.rules:L44-L50`). 그러므로 저장소 구성의 실제 배포 일치 여부는 런타임 확인이 필요하지만, 일치한다면 `setDoc`은 반드시 실패한다. Functions에도 signup export가 없다(`functions/index.js:L96-L97`).

목표 diff: Auth 생성까지 frontend가 담당하되 ID token을 가진 callable만 `{name,email,phoneSuffix,instructorCode,masterCode}`를 받아 Secret 검증 → role 결정 → `student_id_reservations/{4digits}` create와 `users/{uid}` write를 transaction으로 묶어야 한다. response는 canonical role과 stable error code를 반환하고 redirect는 그 결과 또는 AuthContext profile을 사용해야 한다.

## 6. Student ID Concurrency Audit

현재 uniqueness check는 `where(phoneSuffix == input)` read와 Auth/user create 사이가 분리돼 있어 동시 요청 두 개가 모두 통과한다(`src/pages/Signup.tsx:L60-L75`). `cascadeUpdateStudentId`도 reservation 없이 user와 reports만 batch 갱신한다(`src/services/masterAdminService.ts:L161-L188`). batch는 기존 중복을 검출하지 않으므로 수정 경로도 uniqueness invariant를 깨뜨린다.

`student_id_reservations/{phoneSuffix}`를 transaction에서 존재 확인 후 owner UID와 함께 생성해야 하며 신규 가입, 관리자 ID 변경, 탈퇴 release가 같은 서버 정책을 사용해야 한다. legacy 중복은 즉시 강제 migration하지 말고 충돌 상태를 별도 보고하고 신규 claim만 막아야 한다. 현재 중복 알림은 users 전수 scan과 개별 reread/write다(`src/services/masterAdminService.ts:L195-L247`)라서 reservation 대체물이 아니다.

## 7. Class Integrity Audit

source of truth 의도는 `classIds`가 membership, `classId`가 대표, `className`이 대표 이름이다. helper의 `normalizeClassIds`는 legacy `classId`를 합쳐 읽고(`src/services/classTransferService.ts:L45-L55`), assignment helpers는 세 필드를 함께 쓴다(`L200-L228`, `L246-L278`). 그러나 실제 ClassManager는 helper를 우회한다.

케이스 추론:

- 보조반 rename: 해당 반 membership 전체의 `className`을 새 이름으로 덮으므로 대표반 이름이 보조반 이름으로 오염된다(`src/pages/Admin/ClassManager.tsx:L280-L295`).
- 대표반 rename: 결과는 맞지만 개별 client writes라 부분 실패 가능성이 있다(`L285-L295`).
- 보조반 delete: nextIds의 순서를 유지해 기존 대표가 남으면 대표 ID는 우연히 유지될 수 있으나 이름을 null로 만든다(`L329-L340`).
- 대표반 delete: `nextIds[0]`을 새 대표로 정하나 해당 class doc 이름을 조회하지 않고 null을 저장한다(`L331-L340`).
- 마지막반 delete: 세 membership 필드가 empty/null이 되어 의도와 맞지만 class doc delete와 user updates가 원자적이지 않다(`L329-L345`).

rename은 `student.classId === renamedId`인 문서만 denormalized name을 갱신해야 한다. delete는 각 student의 기존 대표 여부를 보고 successor를 결정한 뒤 successor class name까지 같은 mutation command에서 써야 한다.

## 8. Account Deletion & Report Ownership Audit

`purgeUserFirestoreData`는 먼저 해당 UID를 학생 identity로 가진 report를 미할당화하면서 동시에 `reports.uid == uid`를 삭제한다(`src/services/accountDeletionService.ts:L172-L180`). 두 query가 같은 문서를 포함하면 update와 delete batch가 병렬 경합한다. 더 중요한 문제는 `uid`가 uploader인데도 계정 삭제가 report 삭제 의미로 사용된다는 점이다. ADMIN/INSTRUCTOR 삭제 시 그들이 업로드한 학생 report가 삭제될 수 있어 목표 8과 충돌한다.

학생 삭제는 identity link를 해제하되 원본 report를 보존하는 정책이 일부 구현돼 있다(`L63-L80`). 다만 studentId도 null로 지워 legacy 재연결 단서를 소실할 수 있으므로 sourceStudentId 보존 여부를 명시해야 한다. user doc 삭제가 항상 `users/{uid}`만 겨냥해 custom-ID doc은 남길 수 있다(`L182-L182`, AuthContext의 custom doc 지원은 `src/contexts/AuthContext.tsx:L71-L90`).

관리자 Auth 삭제 endpoint는 Authorization header를 허용하지만 token을 읽거나 검증하지 않는다(`functions/index.js:L10-L35`, `L56-L78`). CORS `*`, GET 허용, query uid 수용까지 결합되어 외부 caller가 임의 Auth 계정을 삭제할 수 있는 P0 취약점이다.

## 9. Report Query / Firestore Index Audit

실제 주요 query와 index 대조:

| query symbol | evidence | 요구 composite | 선언 | 비용/문제 |
|---|---|---|---|---|
| 학생 uid reports | `src/pages/Student/ReportView.tsx:L146-L190` | `studentUid ASC + createdAt DESC` | `firestore.indexes.json:L19-L25` | 정상 query 실패 시 무정렬 listener 추가 |
| 학생 ID reports | `src/pages/Student/ReportView.tsx:L193-L223` | `studentId ASC + createdAt DESC` | `firestore.indexes.json:L27-L33` | uid 성공 여부와 무관하게 항상 실행 |
| class reports | `src/lib/pdfProcessor.ts:L2485-L2500` | `classId ASC + createdAt DESC` | `firestore.indexes.json:L11-L17` | catch-all fallback이 권한/네트워크 오류도 재조회 |
| published reports | `src/lib/pdfProcessor.ts:L2503-L2524` | `assignmentStatus ASC + createdAt DESC` | `firestore.indexes.json:L3-L9` | fallback은 전체 결과 client sort |
| 학생 join requests | `src/lib/pdfProcessor.ts:L2029-L2051` | `studentUid ASC + createdAt DESC` | `firestore.indexes.json:L35-L41` | fallback 있음 |
| pending join requests | `src/lib/pdfProcessor.ts:L2057-L2072` | `status ASC + createdAt ASC` | `firestore.indexes.json:L43-L49` | fallback 있음 |
| student stats | `src/hooks/useStudentStats.ts:L25-L40` | `studentUid + createdTime` | 없음 | reports schema의 `createdAt`과도 불일치 |

선언된 composite index는 정확히 6개이고 위 여섯 의도 query와 대응한다. 다만 deployed index 상태는 정적으로 확인할 수 없다. catch-all은 missing-index만 구분하지 않아 permission/network 장애 시 두 번째 read/listener를 만들어 원인을 가린다. student view merge는 report document ID Map으로 dedupe하여 의미는 안정적이다(`src/pages/Student/ReportView.tsx:L137-L144`). identity fallback은 legacy marker 또는 uid 결과가 비어 있을 때만 제한해야 read 비용을 줄일 수 있다.

## 10. PDF Pipeline Audit

production path는 UploadDashboard → base `pdfProcessor.prepareUploadCandidates`/upload 함수다(`src/pages/Admin/UploadDashboard.tsx:L38-L62`, `src/lib/pdfProcessor.ts:L1604-L1663`). `pdfProcessorStable`은 hotfix를, hotfix는 base를 감싸지만 화면 import가 없어 production에는 연결되지 않는다(`src/lib/pdfProcessorStable.ts:L1-L9`, `src/lib/pdfProcessorHotfix.ts:L11-L21`). 따라서 stable/hotfix test 성공을 production 동작으로 간주하면 안 된다.

base parser는 좌표 기반 score table을 우선 구성하고 범위/column confidence를 기록한다(`src/lib/pdfProcessor.ts:L913-L1140`). text fallback의 `parseMetricTriple`은 `(20점 만점)`을 먼저 제거하고 나머지 첫 세 숫자를 `[학생, 평균, 환산]`으로 취한다(`L585-L595`). 따라서 정확히 `독해력 (20점 만점) 89 87 18`이면 의도상 `89/87/18`이다. hotfix/stable도 배점 문구 제거와 converted maximum 검증을 수행한다(`src/lib/pdfProcessorHotfix.ts:L109-L141`, `src/lib/pdfProcessorStable.ts:L44-L82`). 그러나 PDF extraction이 괄호·공백·줄 순서를 변형하면 정규식이 배점을 제거하지 못할 수 있고 base production path에는 stable의 raw-row 재대조가 강제되지 않는다.

`loadPdfJs`는 여러 module/worker candidate를 동적으로 시도한다(`src/lib/pdfProcessor.ts:L1295-L1325`). `package.json:L17-L49`에는 `pdfjs-dist` 직접 의존성이 없어 transitive/환경 의존이다. build/runtime verification 없이는 안정화 완료로 볼 수 없다.

## 11. Score & Trend Audit

목표 fallback `totalScore → scores.total → raw5 weighted → legacy converted sum`은 단일 utility로 구현돼 있지 않다. write parser resolver는 `scores.total → normalized raw weighted → converted sum → raw sum`이다(`src/lib/pdfProcessorHotfix.ts:L173-L186`). report hydration은 `totalScore` 부재를 0으로 확정해 이후 `scores.total` fallback 기회를 없앤다(`src/lib/pdfProcessor.ts:L341-L350`). MasterAdmin의 local `reportTotal`도 direct total을 먼저 보므로 이 0을 실제 점수로 취급한다(`src/pages/Admin/MasterAdminPage.tsx:L55-L68`).

trend는 `compareReportsByExamDateDesc`가 최신→과거다(`src/lib/pdfProcessor.ts:L296-L309`). MasterAdmin은 이 배열에서 `slice(-3)`을 하므로 가장 오래된 3개를 고르고, 그 순서를 과거 방향으로 비교한다(`src/pages/Admin/MasterAdminPage.tsx:L318-L336`). 학생 ReportView도 desc 배열을 reverse하지 않고 chart data로 만든다(`src/pages/Student/ReportView.tsx:L289-L298`). 수정 invariant는 최신 3개 선택 `sorted.slice(0,3)` 후 chart/증감 비교 직전에 `reverse()`이다.

## 12. Legacy Compatibility Audit

호환 read는 상당 부분 존재한다. profile은 `studentId → phoneSuffix → studentKey suffix`를 추론하고 classIds에 legacy classId를 합친다(`src/contexts/AuthContext.tsx:L124-L145`). report date는 `examDate → testDate → writtenAt → createdAt`으로 보완한다(`src/lib/pdfProcessor.ts:L314-L353`). student report는 uid와 studentId 결과를 merge한다(`src/pages/Student/ReportView.tsx:L137-L224`).

그러나 호환과 신규 write가 분리되지 않았다. Signup은 studentId/phoneSuffix/studentKey를 모두 신규 write하고(`src/pages/Signup.tsx:L73-L83`), 관리자 ID 수정은 legacy reports.studentId를 cascade write한다(`src/services/masterAdminService.ts:L161-L188`). `hydrateReportRecord`의 0 기본값은 unknown과 실제 0을 구분하지 못한다. legacy field는 read provenance를 가진 fallback으로만 유지하고 canonical write에는 사용하지 않아야 한다.

## 13. Performance / Listener / Pagination Audit

Auth provider는 listener teardown을 구현했다(`src/contexts/AuthContext.tsx:L173-L178`), Student ReportView도 네 종류 listener를 cleanup한다(`src/pages/Student/ReportView.tsx:L226-L236`). lifecycle leak 증거는 없지만 정상 상태에서도 uid+studentId 두 listener가 병행되고 Login read까지 중복된다.

관리자 목록은 pagination이 없다. `fetchManagedUsers`는 orderBy 실패 시 전체 users를 다시 읽고 client sort한다(`src/services/masterAdminService.ts:L91-L138`). ClassManager는 classes와 student users 전체를 서버에서 로드한다(`src/pages/Admin/ClassManager.tsx:L68-L72`). UploadDashboard의 50개 slice는 렌더 후보 제한일 뿐 backend pagination이 아니다(`src/pages/Admin/UploadDashboard.tsx:L635-L640`). cursor 도입 시 현재 검색이 전체 집합 검색이라는 의미를 잃지 않도록 server prefix/search index 부재에 대한 UX 계약을 먼저 정해야 한다.

## 14. Error & Observability Audit

`startPerformanceTrace`는 lazy initialization과 no-op fallback을 제공한다(`src/lib/performanceMonitoring.ts:L38-L102`). student report 첫 load에는 status/report_count가 기록된다(`src/pages/Student/ReportView.tsx:L117-L125`). 하지만 signup 단계별 latency, profile resolution direct/fallback, PDF extraction/parser confidence, upload write, deletion 단계 KPI가 없다.

오류 모델은 분산돼 있다. account deletion만 `step`과 optional code를 가진다(`src/services/accountDeletionService.ts:L23-L35`). Signup/Login은 Firebase Auth code를 화면 string으로 직접 매핑하고 default로 축약한다(`src/pages/Signup.tsx:L28-L37`, `src/pages/Login.tsx:L35-L47`). Function은 어떤 곳에서는 reason만, 어떤 곳에서는 code까지 반환한다(`functions/index.js:L25-L35`, `L87-L92`). `AUTH_PROFILE_NOT_FOUND`, `SIGNUP_ID_TAKEN`, `SIGNUP_SECRET_INVALID`, `INDEX_MISSING`, `PDF_SCORE_AMBIGUOUS` 같은 stable reason code와 사용자 메시지 mapping을 분리해야 한다.

## 15. Major Engineering Challenges

| 난점 | 현재 코드에서 드러나는 위치 | 해결 방향 |
|---|---|---|
| Auth+Firestore atomicity 부재 | Auth create 후 client setDoc(`src/pages/Signup.tsx:L70-L83`) | idempotent server completion + 실패 compensation; 완전한 cross-service transaction은 불가능함을 계약화 |
| orphan Auth | catch가 메시지만 처리(`src/pages/Signup.tsx:L96-L118`) | callable retry token과 safe Auth delete compensation |
| 학생 ID 동시성 | read-before-write(`src/pages/Signup.tsx:L60-L75`) | reservation transaction을 모든 claim/update/release 경로에 강제 |
| legacy schema 공존 | profile/date fallbacks(`src/contexts/AuthContext.tsx:L124-L145`, `src/lib/pdfProcessor.ts:L314-L353`) | read adapter + provenance; canonical writes 별도 |
| uid/studentUid/studentId 중복 | report type이 세 필드를 보유(`src/lib/pdfProcessor.ts:L109-L143`) | uploaderUid와 studentIdentity 명명/정책 분리 |
| classId/classIds dual | helper normalization(`src/services/classTransferService.ts:L45-L55`) | membership set/primary invariant를 mutation service 하나로 제한 |
| client query 확산 | StudentView와 pdfProcessor에 query가 분산(`src/pages/Student/ReportView.tsx:L146-L223`, `src/lib/pdfProcessor.ts:L2029-L2198`) | query repository와 typed fallback policy |
| listener lifecycle | 네 listener cleanup 필요(`src/pages/Student/ReportView.tsx:L226-L236`) | identity query plan 하나가 subscription 소유 |
| pagination/검색 호환 | full read 뒤 client filter/slice(`src/services/masterAdminService.ts:L91-L138`, `src/pages/Admin/UploadDashboard.tsx:L635-L640`) | cursor cache와 검색 결과 의미 회귀 테스트 |
| Functions/Secret 운영의존 | signup Function/Secret 선언 없음(`functions/index.js:L1-L97`) | Secret binding, emulator contract, 배포 전 smoke gate |
| Rules/Admin SDK 경계 | users client create 금지(`firestore.rules:L44-L50`), Admin delete 공개(`functions/index.js:L56-L78`) | privileged mutation은 verified Function, rules는 client 최소권한 |
| PDF 비정형 텍스트 | max 제거와 첫 3개 숫자(`src/lib/pdfProcessor.ts:L585-L595`) | layout+raw text cross-check, golden corpus, ambiguity fail-closed |
| hotfix 계층 누적 | stable→hotfix→legacy(`src/lib/pdfProcessorStable.ts:L1-L9`) | production facade 하나와 단계별 pure parser |
| 회귀 테스트 부족 | auth/class/delete tests 부재; parser 중심(`src/lib/pdfProcessor.test.ts:L1-L218`) | emulator integration + flow smoke |
| 무중단 migration | resolver가 custom/uid doc 모두 지원(`src/contexts/AuthContext.tsx:L68-L90`) | dual-read/single-write, backfill dry-run, metric 기반 cutover |

## 16. Required Architectural Invariants

1. Role의 source of truth는 서버다.
2. 학생 ID uniqueness는 서버 transaction으로만 확정한다.
3. `className`은 항상 `classId`가 가리키는 class의 실제 이름이다.
4. `classIds`는 membership 집합, `classId`는 대표 membership이다.
5. uploader UID와 student identity는 동일 개념이 아니다.
6. `totalScore` 계산은 단일 canonical utility만 사용한다.
7. legacy field는 읽기 fallback 전용이며 신규 write source가 아니다.
8. 화면 배치를 위해 persisted identity를 변조하지 않는다.
9. pagination이 기존 검색/선택 결과 의미를 바꾸면 안 된다.
10. privileged Auth/Firestore mutation은 검증된 server principal만 수행한다.
11. profile resolution은 한 로그인 세션에서 단일 owner와 유한 retry를 가진다.
12. report 삭제는 uploader 탈퇴의 암묵적 side effect가 될 수 없다.
13. PDF parser가 열 의미를 확정하지 못하면 저장하지 않고 검수 대상으로 둔다.

## 17. Pinpoint Modification Plan

### [AUTH-01] Profile resolver와 로그인 read 통합
현재 상태: `Login.handleSubmit`이 direct profile을 읽고(`src/pages/Login.tsx:L49-L73`), `AuthProvider.subscribeToProfile`이 다시 direct/custom resolution을 수행한다(`src/contexts/AuthContext.tsx:L68-L107`).
문제: 중복 read, custom-ID role 오redirect, 무한 재구독 가능성.
목표 상태: redirect와 route guard가 동일 resolved profile snapshot을 소비한다.
Pinpoint 수정 위치: `src/pages/Login.tsx` / `handleSubmit` / `L49-L73`; `src/contexts/AuthContext.tsx` / `subscribeToProfile` / `L68-L170`.
수정 방식: resolver를 단일 service로 추출하고 provider가 readiness/reason을 노출; Login의 `getDoc` 제거.
변경하면 안 되는 것: 기존 from-path redirect와 role별 기본 destination.
회귀 위험: 로그인 직후 blank/loading, custom doc 권한.
필요 테스트: unit, emulator integration, manual smoke.
우선순위: P1

### [SIGNUP-01] 서버 주도 회원가입 완성
현재 상태: client가 secret 비교, role, uniqueness, user write를 소유한다(`src/pages/Signup.tsx:L39-L95`); Function 없음(`functions/index.js:L96-L97`).
문제: 권한 위조, secret 노출, race, rules 불일치.
목표 상태: 목표 signup flow와 동일한 verified callable invariant.
Pinpoint 수정 위치: `functions/index.js` / exports / `L1-L97`; `src/pages/Signup.tsx` / `handleSubmit` / `L39-L118`; `src/services/masterAdminService.ts` / secret constants·controls / `L21-L89`; `firestore.rules` / users / `L44-L50`.
수정 방식: `completeSignupProfile` 추가, Secret binding, reservation+user transaction, frontend callable 연결, client literals/comparison/write 삭제.
변경하면 안 되는 것: 현 입력 필드, 성공 toast, role별 redirect.
회귀 위험: Functions region/config, existing uid/custom doc, retry duplicate.
필요 테스트: unit, emulator integration, manual smoke.
우선순위: P0

### [SIGNUP-02] Auth 고아계정 compensation
현재 상태: Auth create 이후 모든 실패가 generic catch로 간다(`src/pages/Signup.tsx:L70-L118`).
문제: profile 없는 로그인 가능 계정과 email 재가입 차단.
목표 상태: completion은 idempotent하고 실패 후 재시도 또는 안전한 current-user 삭제가 가능하다.
Pinpoint 수정 위치: `src/pages/Signup.tsx` / `handleSubmit` / `L70-L118`; `functions/index.js` / 신규 signup handler.
수정 방식: completion operation ID, server idempotency, terminal failure에만 client Auth compensation.
변경하면 안 되는 것: 이미 profile이 생성된 성공 계정 삭제 금지.
회귀 위험: response 유실 뒤 잘못된 compensation.
필요 테스트: emulator integration, failure injection.
우선순위: P0

### [DELETE-01] 관리자 삭제 권한과 report 보존
현재 상태: 공개 handler가 uid만으로 Auth delete(`functions/index.js:L39-L97`); client purge가 uploader reports를 삭제(`src/services/accountDeletionService.ts:L172-L180`).
문제: 임의 Auth 삭제, 선생님/관리자 탈퇴가 학생 report 삭제, 병렬 update/delete race.
목표 상태: verified ADMIN만 managed delete; reports는 identity unlink만 하고 보존.
Pinpoint 수정 위치: `functions/index.js` / `deleteUserHandler` / `L39-L94`; `src/services/accountDeletionService.ts` / `purgeUserFirestoreData`, `deleteAuthUserByUid` / `L63-L82`, `L172-L271`.
수정 방식: ID token+server role 검증, callable 단일화, GET/query uid 제거, role-aware server orchestration, `reports.uid` delete 제거.
변경하면 안 되는 것: idempotent already-deleted 처리, 학생 개인정보 unlink 계약.
회귀 위험: partial purge, custom-ID user doc 잔존.
필요 테스트: emulator integration, security negative test, manual smoke.
우선순위: P0

### [CLASS-01] 대표/보조반 mutation 일원화
현재 상태: service helper와 ClassManager direct writes가 공존(`src/services/classTransferService.ts:L200-L317`, `src/pages/Admin/ClassManager.tsx:L268-L345`).
문제: 보조 rename이 대표 이름 오염, delete 후 name null, partial writes.
목표 상태: 모든 user에서 `classId ∈ classIds`이고 className이 실제 대표명이다.
Pinpoint 수정 위치: `src/pages/Admin/ClassManager.tsx` / `handleCreateOrUpdateClass`, `handleDeleteClass` / `L268-L355`; `src/services/classTransferService.ts` / assignment helpers / `L200-L317`.
수정 방식: rename/delete command를 service로 통합하고 대표 조건·successor lookup·chunk failure report 구현.
변경하면 안 되는 것: 다중반 선택 UX, 마지막반 삭제 동작.
회귀 위험: legacy classId-only student 누락.
필요 테스트: unit matrix, emulator integration, manual smoke.
우선순위: P1

### [REPORT-01] identity query plan과 index 오류 분리
현재 상태: uid/studentId listener 병행, 모든 오류에 무정렬 fallback(`src/pages/Student/ReportView.tsx:L146-L224`).
문제: 정상 사용자도 두 query 비용, 권한/네트워크 오류 은폐.
목표 상태: canonical uid 우선, legacy 필요 시에만 ID fallback, missing-index만 제한 fallback.
Pinpoint 수정 위치: `src/pages/Student/ReportView.tsx` / report effect / `L110-L236`; `src/lib/pdfProcessor.ts` / fetch/subscribe functions / `L2029-L2198`, `L2485-L2524`; `firestore.indexes.json` / `L2-L50`.
수정 방식: repository query plan, error code 분기, merge/dedupe 유지, query inventory test.
변경하면 안 되는 것: legacy reports 노출과 실시간 갱신.
회귀 위험: fallback 조건이 오래된 report를 숨김.
필요 테스트: emulator integration, listener lifecycle test.
우선순위: P1

### [SCORE-01] totalScore canonicalization과 추이 순서
현재 상태: resolver가 중복되고 hydration이 unknown을 0으로 만든다(`src/lib/pdfProcessor.ts:L314-L350`, `L1676-L1714`; `src/pages/Admin/MasterAdminPage.tsx:L55-L78`). trend selection/order가 반대다(`src/pages/Admin/MasterAdminPage.tsx:L318-L336`, `src/pages/Student/ReportView.tsx:L289-L298`).
문제: legacy 점수 0 오표시, 서로 다른 화면 총점, 과거 3개 분석.
목표 상태: 명시된 4단계 fallback 한 개와 최신3→oldest/newest 표시 invariant.
Pinpoint 수정 위치: 위 symbols 및 `src/pages/Admin/UploadDashboard.tsx` / score display mapping / `L986-L999`.
수정 방식: pure canonical utility, null 보존 hydration, all consumers 교체, `slice(0,3).reverse()`.
변경하면 안 되는 것: 실제 0점, 기존 가중치 20/30/20/20/10.
회귀 위험: raw scale와 converted scale 오판.
필요 테스트: unit golden matrix, component test.
우선순위: P1

### [PDF-01] production parser facade 통합
현재 상태: stable/hotfix가 base를 감싸지만 UI는 base import(`src/lib/pdfProcessorStable.ts:L1-L9`, `src/pages/Admin/UploadDashboard.tsx:L38-L62`).
문제: 테스트된 보정이 production 미사용, 세 계층의 override 책임 불명확.
목표 상태: 단일 production facade에서 extraction→parse→stabilize→validate 순서 고정.
Pinpoint 수정 위치: `src/lib/pdfProcessor.ts` / parsing exports / `L585-L595`, `L913-L1140`, `L1604-L1663`; `src/lib/pdfProcessorHotfix.ts` / `L1-L245`; `src/lib/pdfProcessorStable.ts` / `L1-L120`; UploadDashboard imports.
수정 방식: stable facade를 public entry로 결정하고 circular re-export 없이 pure stages로 축소.
변경하면 안 되는 것: upload/matching UI와 legacy report write contract.
회귀 위험: multi-page parsing, worker bundle, timeout/concurrency.
필요 테스트: unit golden PDF/text, build, manual real-PDF smoke.
우선순위: P1

### [PERF-01] pagination·KPI·error taxonomy
현재 상태: full collection reads(`src/services/masterAdminService.ts:L91-L138`), 일부 trace만 존재(`src/pages/Student/ReportView.tsx:L117-L125`), 오류 contract 분산.
문제: 규모 증가 시 latency/read 폭증, 장애 원인 집계 불가.
목표 상태: 의미 보존 cursor pagination, 주요 flow KPI, stable reason code.
Pinpoint 수정 위치: `src/services/masterAdminService.ts` / `fetchManagedUsers` / `L91-L138`; `src/lib/performanceMonitoring.ts` / `L38-L102`; Signup/Login/deletion error mappings.
수정 방식: page result/cursor contract, search cache strategy, shared error types, trace dimensions.
변경하면 안 되는 것: 전체 검색/선택 의미와 한국어 사용자 메시지.
회귀 위험: 페이지 밖 선택 유실, high-cardinality metric.
필요 테스트: unit, integration, benchmark, manual smoke.
우선순위: P2

## 18. PR-by-PR Implementation Sequence

| PR | 목적 | 수정파일 후보 | dependency | migration | regression scope / test gate | rollback |
|---|---|---|---|---|---|---|
| PR-1 | 삭제 endpoint 즉시 잠금과 report 보존 | `functions/index.js`, `src/services/accountDeletionService.ts` | 없음 | 없음 | unauthorized/ADMIN/student/instructor emulator tests | 중간: endpoint contract 변경 |
| PR-2 | canonical profile resolver와 error contract | AuthContext, Login, 신규 auth service | 없음 | 없음 | uid/custom-ID/없는 profile/login redirect | 낮음 |
| PR-3 | signup Function, Secret, reservation | Functions, Signup, masterAdminService, rules | PR-2 error contract | reservation bootstrap는 legacy 충돌 audit 필요 | concurrent signup, secret role, rules emulator | 높음: 운영 Secret 의존 |
| PR-4 | signup compensation/idempotency | Signup, signup Function | PR-3 | operation records TTL 선택 | response loss/failure injection/orphan test | 중간 |
| PR-5 | class membership integrity | ClassManager, classTransferService | profile resolver의 doc ref contract | legacy classId-only dry-run/backfill | 5개 rename/delete case matrix | 중간 |
| PR-6 | report identity/ownership repository | accountDeletionService, pdfProcessor query 영역, Student ReportView | PR-1 | optional uploaderUid field backfill | delete preservation, dual identity, dedupe | 높음 |
| PR-7 | canonical score utility와 trend | pdfProcessor hydrate, MasterAdmin, Student ReportView, UploadDashboard | 없음 | read-time only 우선 | fallback table + latest3 ordering | 낮음 |
| PR-8 | PDF public facade와 dependency 고정 | 세 processor, UploadDashboard, package manifests | PR-7 utility | 없음 | golden corpus, build, real PDF smoke | 중간 |
| PR-9 | query/index/listener consolidation | report repository, indexes, useStudentStats | PR-6 | index deploy 필요 가능 | emulator query inventory, listener cleanup | 중간 |
| PR-10 | 관리자 pagination | masterAdminService, MasterAdminPage, ClassManager/UploadDashboard | PR-2, PR-9 patterns | 없음 | 검색·선택 의미, cursor invalidation | 중간 |
| PR-11 | KPI/error observability 확대 | performanceMonitoring, 주요 flows | PR-2/3/6/8 stable codes | 없음 | no-op 환경, metric cardinality | 낮음 |

순서는 보안 노출을 먼저 차단하고, 공통 identity/error 계약을 만든 뒤 signup과 데이터 정합성을 올리는 의존성 기준이다. PDF와 score는 score utility가 먼저여야 하고, pagination은 query repository와 identity semantics가 안정된 뒤 적용해야 한다.

## 19. Regression Test Matrix

| 영역 | 필수 시나리오 | 종류 | 현재 존재 |
|---|---|---|---|
| 회원가입 | 3 role, 잘못된 code, 동일 4자리 동시 20요청, callable timeout/response loss, Auth compensation | unit+emulator+manual | 없음 |
| 로그인 | uid doc, custom-ID doc, 두 doc 충돌, profile 없음, 네트워크 retry 상한, from redirect | unit+emulator+component | 없음 |
| 삭제 | unauthorized caller, ADMIN only, instructor uploader report 보존, student unlink, custom doc, partial retry | emulator+security+manual | 없음 |
| 반 | 보조 rename/delete, 대표 rename/delete, 마지막반 delete, legacy classId-only, chunk partial failure | unit+emulator | 없음 |
| query/index | 6 composite queries, missing-index만 fallback, uid/ID merge dedupe, unsubscribe | emulator+unit | 없음 |
| PDF | `독해력 (20점 만점) 89 87 18`, whitespace/괄호 변형, 5행, multi-page, low confidence 차단 | unit golden+manual | 일부(`src/lib/pdfProcessorStable.test.ts:L1-L60`) |
| score | 네 단계 fallback, 실제 0, missing/null, raw weighted, converted legacy | unit | 일부 parser total test(`src/lib/pdfProcessor.test.ts:L191-L218`) |
| trend | 1/2/3/4 reports, same date, missing date, latest3 selection, oldest→newest chart | unit+component | 없음 |
| pagination | 다음/이전, 검색, page 밖 선택 유지, concurrent insert, order tie | integration+manual | 없음 |
| KPI/error | trace stop once, no-op 환경, stable code→한국어 메시지 | unit | performance 일부(`src/lib/performanceMonitoring.test.ts:L1-L35`) |

정적 감사 중 명령 실행 환경에는 local dependencies가 설치돼 있지 않아 test/typecheck/build는 실행되지 않았다. 이는 코드 실패 판정이 아니라 검증 환경 blocker다.

## 20. Final Priority (P0~P3)

**P0**

1. 공개 Admin SDK 삭제 endpoint에 caller 인증·ADMIN 검증을 추가하고 GET/query 호출을 제거한다.
2. `reports.uid` 기반 삭제를 중단하고 uploader와 student identity를 분리한다.
3. `completeSignupProfile` + Secret 검증 + role server 결정 + ID reservation transaction을 연결한다.
4. callable 실패/응답 유실에 안전한 idempotency와 orphan Auth compensation을 구현한다.

**P1**

1. profile resolver/로그인 read를 단일화하고 custom-ID 오류·retry를 표준화한다.
2. class rename/delete를 대표반 invariant 기반 command로 통합한다.
3. totalScore fallback을 단일 utility로 만들고 최신 3개/시간축 순서를 수정한다.
4. stable/hotfix 보정을 실제 production facade에 연결하고 PDF.js dependency를 고정한다.
5. report identity fallback을 조건부로 만들고 6개 index/query 계약을 emulator에서 검증한다.
6. auth/class/delete/query regression test를 추가한다.

**P2**

1. 관리자 목록 cursor pagination을 기존 전체 검색·선택 의미를 보존하며 도입한다.
2. signup/profile/PDF/upload/delete KPI와 stable error reason을 추가한다.
3. legacy read provenance와 migration 관측 지표를 추가한다.

**P3**

1. compatibility metric이 충분히 낮아진 뒤 legacy fallback 제거 시점을 결정한다.
2. 사용되지 않는 processor facade와 오래된 호환 field를 단계적으로 제거한다.
