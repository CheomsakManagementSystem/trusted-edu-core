# Firebase 반 배정 Flow Audit

감사 기준 시각: 2026-08-05 14:05 KST  
감사 대상: 저장소 `trusted-edu-core`, Firebase 프로젝트 `kimyunhwannonsul`, 운영 Firestore `(default)`  
감사 방식: 코드 정적 추적, Firebase CLI 프로젝트/배포 상태 조회, Firestore REST API 읽기 전용 집계. 운영 데이터는 개인정보를 출력하지 않고 건수·필드·ID 관계만 집계했다. 데이터 수정·Rules 배포·Emulator 쓰기 테스트는 수행하지 않았다.

## 1. Executive Summary

핵심 P0 원인은 `users` 문서의 실제 Document ID와 내부 `uid`를 같은 값으로 가정한 쓰기 계약이다. 운영 데이터에는 `role=STUDENT`인 700개 문서 중 Document ID와 내부 `uid`가 다른 문서가 169개 있다. 현재 반 배정 화면은 조회 시 `snapshot.id`를 버리고 내부 `uid`를 학생 키로 사용한 뒤 `users/{uid}`에 쓴다. 이 169명 중 116명은 `users/{uid}` 문서가 별도로 존재하며, 114개는 역할 없이 반 배정 관련 필드만 가진 유령 문서다. 원본과 유령 문서의 `classIds`가 다른 쌍은 105개다. 따라서 쓰기 Promise가 성공해도 실제 프로필 문서는 바뀌지 않고, 재조회/새로고침 시 원본 값으로 돌아가는 현상이 코드와 운영 데이터로 **CONFIRMED**다.

P1 원인은 Canonical 후보인 `users/{actualDocId}.classIds[]`와 화면 표시용 `className`/legacy `classId`의 갱신 계약이 서로 다르다는 점이다. 현재 일괄 배정은 `classIds`만 갱신하지만 학생의 “현재 소속 반”은 `user.className`을 표시한다. 이 때문에 올바른 문서에 쓴 경우에도 현재 반 표시가 즉시 또는 일관되게 갱신된다는 보장이 없다.

운영 Security Rules는 2026-03-19 배포된 `allow read, write: if true`이며, 현재 배정 실패의 원인은 아니다. 대신 비로그인 사용자를 포함한 누구나 모든 문서를 읽고 수정할 수 있는 **독립적인 P0 보안 취약점**이다. 저장소의 로컬 Rules는 운영과 다르고, 적용 시 관리자 타인 조회·수정 및 반 생성/수정을 모두 거부한다.

## 2. 사용자 관점 증상

| 증상 | 근거 기반 설명 | 판정 |
|---|---|---|
| 배정이 안 됨 | 실제 학생 문서가 custom Document ID이면 `users/{uid}`에 잘못 쓰고 원본은 불변 | CONFIRMED |
| 된 것처럼 보이다 새로고침 후 사라짐 | 로컬 UI 성공 처리 후 서버 재조회는 원본 custom-ID 문서를 다시 읽음. 운영에 원본/유령 불일치 105쌍 존재 | CONFIRMED |
| 현재 반이 화면에 반영 안 됨 | 배정 쓰기는 `classIds`만 바꾸는 경로가 있으나 학생 화면은 `className`을 표시 | CONFIRMED(코드), 운영 재현 레코드는 미수집 |
| 일부 학생만 정상 | Document ID가 `uid`와 같은 학생 531명과 다른 학생 169명이 공존 | CONFIRMED |

## 3. 프로젝트·환경 구성

- `.firebaserc` 기본 프로젝트: `kimyunhwannonsul`.
- 과거 런타임 `.env`의 `VITE_FIREBASE_PROJECT_ID`도 `kimyunhwannonsul`; 현재 워크트리에는 `.env`가 없다.
- Firebase CLI 인증 계정에서 프로젝트 `kimyunhwannonsul`이 ACTIVE임을 확인했다.
- Firestore database: `(default)`, `firebase.json` 선언 location은 `nam5`.
- 클라이언트는 `src/lib/firebase.ts`에서 환경변수로 Firebase 앱을 초기화한다. Emulator 연결 코드는 없다.
- 실행 중인 Firestore Emulator와 Emulator export 데이터는 없었다.
- 운영 배포 Rules와 로컬 `firestore.rules`의 SHA가 다르다. 운영 ruleset 생성 시각은 `2026-03-19T04:02:52Z`다.

환경별 Project 불일치는 현재 저장소/운영 확인 범위에서는 **REJECTED**다. 단, Vercel 배포 환경변수 자체는 이 감사에서 읽지 못했으므로 배포 프런트의 런타임 값은 **UNVERIFIED**다.

## 4. 실제 데이터모델

운영 데이터 집계 결과:

| Collection | 건수 | 실제 역할 |
|---|---:|---|
| `users` | 891 | 사용자·학생 프로필 및 반 소속의 실질 원본 |
| `classes` | 20 | 반 이름/생성·수정 시각 |
| `class_members` | 5 | `joinClass` 경로가 만드는 일부 관계 문서; 전체 배정 원본이 아님 |
| `enrollment_events` | 16 | 일부 self-join 이벤트 |
| `classAssignments` | 0 | 미사용 |

학생 700명 중 682명은 `classIds` 필드를 가지며, 512명은 비어 있지 않은 `classIds`로 배정 상태다. `classId`와 `className`이 존재하는 학생도 각각 512명이다. 존재하는 학생 `classIds`가 가리키는 ghost class reference는 0건이었다. `classes.studentIds`는 모든 반 문서에 없다. 학생/반 어느 문서에도 `academyId`는 없다.

확정 모델은 후보 B'의 tenant 없는 변형이다: `users/{actualDocId}.classIds[]`. 현재는 다중 반을 지원하므로 단일 `currentClassId`가 아니라 배열이 원본이다. `classId`, `className`, `isEnrolled`, `enrollmentStatus`는 파생/legacy 필드다. `class_members`와 `enrollment_events`는 일부 경로만 쓰므로 Canonical Source가 될 수 없다.

## 5. Collection·Document Path

| 의미 | 실제 Path | Document ID 생성/의미 | 주요 필드 |
|---|---|---|---|
| 학생 프로필 | `users/{actualDocId}` | 신규는 Auth UID, 기존 일부는 custom ID | `uid`, `role`, `classIds`, legacy `classId/className` |
| 반 | `classes/{autoId}` | `addDoc` 자동 ID | `name`, `createdAt`, `updatedAt` |
| 반 멤버 | `class_members/{classId_uid}` | 합성 ID | `classId`, `uid`, 표시 필드 |
| 가입 이벤트 | `enrollment_events/{autoId}` | 자동 ID | `type`, `classId`, `uid`, `createdAt` |
| 배정 별도 컬렉션 | `classAssignments/{id}` | 미사용 | 운영 0건 |

`studentId`는 4자리 업무 식별자이고 Auth UID나 Firestore Document ID가 아니다. 내부 `uid`는 Firebase Auth UID다. 반 ID는 `classes` snapshot Document ID다.

## 6. E2E Flow

### 관리자 `/admin/class-manager`

1. `RequireStaff`가 AuthContext 로딩 완료와 role을 확인한다.
2. `getDocsFromServer`로 `classes`와 `users where role in [student, STUDENT]`를 조회한다.
3. 반은 `snapshot.id`를 보존한다.
4. 학생은 `uid = data.uid ?? snapshot.id`로 hydrate하여 실제 Document ID를 버린다.
5. UI 선택값은 학생 `uid`, 반 `classes/{snapshot.id}`를 사용한다.
6. `bulkAddClassIdToStudents`는 `writeBatch`로 `users/{studentUid}.classIds`에 `arrayUnion`한다.
7. `await batch.commit()` 후 `getDocsFromServer`로 재조회하고 성공 메시지를 표시한다.
8. custom Document ID 학생은 6단계에서 다른 문서에 쓰므로 7단계에서 원본 상태가 다시 나타난다.

### 학생 `/dashboard/account`

AuthContext는 먼저 `users/{authUid}`를 찾고, 없으면 `where uid == authUid`로 실제 custom 문서를 찾아 구독한다. 그러나 반 변경은 `user.docPath`가 아니라 `updateStudentClassAssignment(user.uid, ...)`를 호출하여 다시 `users/{authUid}`에 쓴다. 반면 학생 ID 수정은 올바르게 `user.docPath`를 사용한다. 같은 화면 안에서도 문서 경로 계약이 다르다.

### 미사용/부분 사용 경로

`StudentAssignmentSection`은 라우트/import가 없어 현재 앱에서 사용되지 않는다. 이 컴포넌트는 Select 변경을 로컬 pending state에만 저장하고 일반 저장 버튼이 없으며, “강제 동기화”에서만 DB에 쓴다. `joinClass`는 `class_members`, `users.classIds`, `enrollment_events`를 batch로 쓰지만 현재 호출처가 없다.

## 7. 가설검증결과

| ID | 코드 위치 / Path / 재현조건 / 결과 / 영향범위 | 판정 |
|---|---|---|
| A | `src/lib/firebase.ts`, `.firebaserc`; 코드와 조회한 운영 프로젝트는 동일. Vercel 런타임 env는 미확인 | PARTIALLY |
| B | `ClassManager.tsx:43-55`, `AuthContext.tsx:72-95`, `classTransferService.ts:201-218`; custom doc 학생 배정 시 `users/{uid}` 오기록. 운영 custom 학생 169, 유령 target 114, 불일치 105 | **CONFIRMED** |
| C | `ClassManager.tsx:72-77,127-129`; Dropdown/선택값은 `classes` snapshot ID 사용. 내부 classId 필드 없음 | REJECTED |
| D | 쓰기·관리 조회 원본은 `users.classIds`; 학생 현재 반 표시는 `className`; `class_members`는 5건뿐이고 assignment collection은 0건 | **CONFIRMED** |
| E | `classes.studentIds` 모델은 운영에 존재하지 않음. `class_members`를 쓰는 경로와 안 쓰는 경로가 혼재 | PARTIALLY |
| F | 운영 ruleset은 전면 허용이므로 permission-denied 원인은 아님. 로컬 Rules를 배포/Emulator 사용하면 admin 흐름은 거부됨 | REJECTED(현재 실패), **CONFIRMED(보안 결함/환경 차이)** |
| G | `RequireStaff`는 AuthContext 로딩 완료 후 화면 진입. 버튼 흐름도 auth.currentUser를 직접 요구하지 않음 | REJECTED |
| H | 관련 `setDoc`은 `{merge:true}`, batch set도 merge 사용 | REJECTED |
| I | 주요 배정은 `set(..., merge)`여서 미존재 문서를 실패시키지 않고 유령 문서를 생성함. `updateDoc` 경로의 미존재 실패는 현재 운영 재현 없음 | PARTIALLY |
| J | 배정 batch 구성의 `forEach`는 비동기 콜백이 아니며 commit을 await함. 다른 Promise.all도 await함. 500건 chunk는 없음 | REJECTED(통상 UI 규모), PARTIALLY(500+ 한도) |
| K | `batch.commit`, `forceSync`를 모두 await한 뒤 성공 UI 처리 | REJECTED |
| L | 관련 payload에 undefined는 없고 nullable은 null로 명시. Timestamp는 운영에서 `timestampValue` | REJECTED |
| M | 대상 반 선택 시 이미 그 반에 속한 학생을 배정 후보에서 제외하는 의도적 필터가 있음. 서버 쿼리는 배정 학생을 제외하지 않음 | REJECTED(재조회 소실 원인), PARTIALLY(UI 오해 가능) |
| N | ClassManager는 cache가 아닌 `getDocsFromServer` 사용. 미사용 컴포넌트는 cache snapshot을 무시함 | REJECTED(활성 화면) |
| O | Firestore converter를 사용하지 않음 | REJECTED |
| P | 앱은 다중 반 추가를 허용하고 별도 일괄 교체 UI를 제공. “이동”과 “복수 추가” 정책이 화면/서비스마다 다름 | **CONFIRMED** |
| Q | 정원 필드/검사 없음. 동시 arrayUnion은 ID 유실을 막지만 정원·정책 원자성은 검증 불가 | UNVERIFIED |
| R | 추가는 arrayUnion, 제거는 arrayRemove. 제거 후 남은 반이 1개여도 `remainingCount <= 1` 때문에 `isEnrolled=false`가 될 수 있음 | **CONFIRMED** |
| S | 활성 관리자·학생 화면은 직접 쓰기. assignment용 callable Function은 없음 | **CONFIRMED** |
| T | 배포 Function은 HTTPS 계정삭제 2개뿐이며 Firestore Trigger는 0개 | REJECTED |

## 8. ID·Field Contract Matrix

| 항목 | UI 값 | Firestore Doc ID | 내부 필드 | 실제 저장 위치 | 판정 |
|---|---|---|---|---|---|
| 학생 | `student.uid` | `users/{actualDocId}` | `uid` | 현재 코드는 `users/{uid}` | **불일치** |
| 반 | `selectedClass.id` | `classes/{docId}` | 별도 `classId` 없음 | `users.classIds[]` | 일치 |
| 학원 | 없음 | tenant path 없음 | `academyId` 없음 | 없음 | 미구현 |
| 현재 반 원본 | `student.classIds` | N/A | `classIds[]` | 실제 학생 문서 | 조건부 일치(문서 경로 오류) |
| 현재 반 표시 | `user.className` 또는 class ID→name lookup | N/A | `className` | `users` 파생 필드 | 불일치 가능 |
| 반 학생목록 | `studentsByClassId` | class 문서에는 목록 없음 | `users.classIds` 역계산 | `users` | 일치 |

필수 계약은 `{ docId: snapshot.id, uid: data.uid, studentId: data.studentId }`를 서로 다른 필드로 유지하는 것이다. 현재 `StudentLite.uid` 하나로 Document ID와 Auth UID를 겸용하는 것이 결함이다. Converter는 없다. Timestamp 필드는 Firestore Timestamp다. nullable 필드는 `classId`, `className`, `enrollmentStatus`다.

## 9. Auth 감사

- G1은 라우트 레벨에서 충족된다. `RequireStaff`/`RequireAuth`는 `loading=false` 전까지 하위 화면을 렌더링하지 않는다.
- Custom Claims는 사용하지 않는다. 권한은 클라이언트가 읽은 `users.role` 필드로 판단한다.
- AuthContext는 실제 프로필 ref를 올바르게 찾아 `docPath`까지 제공한다.
- 배정 서비스가 `docPath`를 받지 않고 Auth UID만 받기 때문에 AuthContext의 올바른 ref 해석 결과가 쓰기에서 소실된다.
- 클라이언트 role gate는 보안 경계가 아니다. 운영 Rules 전면 허용 때문에 우회 가능하다.

## 10. Security Rules 감사

운영 배포 Rules:

```firestore
match /{document=**} {
  allow read, write: if true;
}
```

| 작업 | 운영 | 로컬 Rules를 적용할 경우 |
|---|---|---|
| 학생/반 읽기 | 누구나 허용 | classes는 로그인 허용, users는 self만 허용 |
| 타 학생 수정 | 누구나 허용 | self만, 그리고 `classIds`만 허용 |
| 반 생성/수정/삭제 | 누구나 허용 | 전부 거부 |
| Assignment | collection rule 없음이나 catch-all로 허용 | 명시 rule 없음→거부 |
| 타 academy 접근 | academy 개념 없음 | academy 개념 없음 |
| 관리자 Role | 검사 없음 | 검사 없음 |
| 허용 외 필드 | 제한 없음 | self user update는 `classIds`만 |

따라서 현재 장애를 `permission-denied`로 설명할 수는 없다. 반대로 운영 데이터는 심각하게 과다 노출/변조 가능하다. 로컬 Rules는 활성 관리자 UI와 호환되지 않으므로 그대로 배포해서도 안 된다. 같은학원 관리자 허용, 타학원 거부 등의 요청된 Emulator 시나리오는 `academyId`와 테스트 계정/fixture가 없어 실행 불가이며 계획으로 남긴다.

## 11. Listener·조회 Flow 감사

- 활성 ClassManager는 listener가 아니라 매 작업 후 `getDocsFromServer`로 서버 원본을 강제 조회한다. 캐시 때문에 소실되는 것이 아니다.
- AuthContext는 실제 프로필 문서에 `onSnapshot`을 연결한다. 잘못 생성된 `users/{uid}` 유령 문서는 custom 프로필을 구독하는 학생에게 반영되지 않는다.
- ClassManager의 role query는 역할 없는 유령 문서 114개를 제외한다. 따라서 잘못 쓴 결과가 관리 목록에서도 보이지 않는다.
- `classIds`에서 반 이름을 lookup하는 관리 화면과 `className`을 직접 표시하는 학생 화면의 mapper 계약이 다르다.
- 활성 쿼리에 필요한 운영 Index 오류 증거는 없다. classes orderBy와 users `in` 쿼리는 단일 필드 범위다.

## 12. Root Cause

### RC1 — P0: 실제 Document ID 유실

조회 mapper가 `snapshot.id` 대신 내부 `uid`만 보존한다. 모든 배정 서비스가 `doc(db, "users", studentUid)`를 구성한다. custom-ID 원본을 가진 학생에게 쓰면 별도 uid 문서가 생성되고 `setDoc(..., merge)`는 성공한다. 성공은 잘못된 문서의 저장 성공일 뿐이다.

운영 증거는 다음과 같다.

- 학생 원본 700개 중 Document ID ≠ 내부 uid: 169개.
- 이 169개 중 `users/{uid}` 별도 문서 존재: 116개.
- 별도 문서 중 role 없음: 114개.
- 원본과 별도 문서 `classIds` 불일치: 105개.

### RC2 — P1: Canonical과 표시 필드 분리

`bulkAddClassIdToStudents`, `updateStudentClassIds`, `bulkUpdateStudentClassIds`는 `classIds`를 갱신하지만 `className`을 일관되게 갱신하지 않는다. 학생 계정 화면은 `user.className`을 현재 반으로 표시한다. `classId/className`과 `classIds`를 동시에 원본처럼 취급하는 계약이 현재 반 미표시/오표시를 만든다.

### RC3 — 독립 P0 Security: 운영 Rules 전면 개방

배정 장애 원인은 아니지만 즉시 차단해야 하는 보안 사고 수준의 구성이다.

## 13. 정합성 위험

- `users/{customDocId}`와 `users/{uid}` 중복 문서 및 서로 다른 배정 상태.
- `classIds`와 legacy `classId/className`의 stale 가능성.
- `class_members` 5건과 실제 배정 학생 512명의 큰 차이: 두 모델을 동일한 원본으로 볼 수 없음.
- 제거 후 한 반이 남아도 `isEnrolled=false`가 되는 off-by-one 조건.
- 반 삭제 시 여러 학생 update와 class delete가 하나의 batch가 아니어서 부분 실패 가능.
- batch helper에 500 write chunk가 없어 500명 초과 일괄 작업은 실패한다.
- capacity/중복 정책 문서와 transaction이 없어 동시 관리자 정책 충돌을 막지 못한다.
- tenant/academy 필드가 전혀 없어 학원 간 격리를 구현할 데이터 계약이 없다.

## 14. UI·UX 감사

활성 ClassManager에는 학생 검색, 현재 반 목록, 대상 반, 선택 checkbox, 관리용 다중 반 선택이 있다. 다음은 부족하다.

- 학년, 선택 인원 수, 대상 반 기존 인원, 미배정 인원, 배정 상태를 한 화면에서 명확히 보여주지 않는다.
- “선택 학생 배정”은 이동이 아니라 복수 반 추가인데 정책 문구가 충분히 명확하지 않다.
- 기존 반 학생 처리 정책(이동/복수추가/종료 후 신규)이 화면별로 다르다.
- 성공 toast는 commit 및 재조회 후 표시되어 순서는 맞지만, 재조회 값이 요청값과 같은지 검증하지 않고 성공 처리한다.
- 학생 계정이 직접 반을 변경할 수 있어 운영 정책·보안 모델과 충돌할 가능성이 크다.
- 오류는 message로 표시하지만 Firebase error code와 실패 path/doc ID는 사용자/운영자에게 구조화해 제공하지 않는다.
- 미사용 `StudentAssignmentSection`은 Select 변경만으로 저장되는 것처럼 보이지만 실제 일반 저장 동작이 없다.

## 15. P0~P3 계획

| 우선순위 | 조치 | 대상 |
|---|---|---|
| P0 | 학생 모델에 `docId`를 보존하고 모든 profile write가 `users/{docId}`를 사용하도록 계약 변경 | ClassManager, AccountSettings, classTransferService 및 uid-only 호출처 |
| P0 | 운영 Rules 전면 허용 제거; 인증·role·허용 필드·tenant 정책 확정 후 Emulator 테스트와 함께 배포 | `firestore.rules`, rules tests |
| P0 | 114개 유령 문서와 105개 불일치 쌍을 백업·검토한 뒤 원본으로 병합/격리하는 별도 데이터 정리 | migration script(신규) |
| P1 | `classIds`만 Canonical로 선언하고 현재 반 이름은 `classes` lookup으로 계산; legacy 필드 write 중단/파생화 | AuthContext, AccountSettings, 관련 UI |
| P1 | commit 후 서버에서 대상 `docId`를 재조회하여 요청한 classIds와 동일할 때만 성공 표시 | ClassManager/service |
| P2 | remove off-by-one 수정, 반 삭제를 chunked batch/검증 흐름으로 전환, 500 한도 처리 | classTransferService, ClassManager |
| P2 | 다중 반/이동/정원/동시성 정책 확정 후 필요한 경우 transaction 도입 | 도메인 서비스 |
| P3 | 선택 수·현재 반·기존 반 인원·미배정 수·이동 경고·에러 코드 표시 | ClassManager UI |

## 16. 수정대상 파일

P0/P1 확정 대상:

- `src/pages/Admin/ClassManager.tsx`: hydrate 모델에 `docId` 보존, selection key와 write target 분리, 저장 후 값 검증.
- `src/services/classTransferService.ts`: 모든 함수 인자를 `studentUid: string`에서 명시적 document ref/`studentDocId` 계약으로 변경; legacy 필드 정책 정리.
- `src/pages/Student/AccountSettings.tsx`: 반 변경도 이미 보유한 `user.docPath` 사용; 현재 반 이름은 class lookup.
- `src/contexts/AuthContext.tsx`: `docPath` 계약을 배정 서비스까지 전달하고 `className` 직접 표시 의존 제거.
- `firestore.rules`: 운영 정책과 일치하는 role/필드 제한 구현.
- 신규 Rules test 및 데이터 정리 script.

보조/정리 대상:

- `src/components/admin/StudentAssignmentSection.tsx`: 미사용 제거 또는 활성 화면과 동일 계약으로 통합.
- `src/components/admin/IntegrityManager.tsx`: 중복 uid/custom-doc 및 유령 문서 진단 추가.
- `src/services/masterAdminService.ts`, `src/lib/pdfProcessor.ts`: `uid`로 profile doc ref를 구성하는 동일 패턴 전수 수정.

## 17. Emulator·회귀테스트 계획

먼저 익명 fixture만 사용하는 Emulator suite를 만든다. 모든 시나리오는 UID, role, 실제 path/doc ID, 전후 값, error code, 화면 반영, 새로고침 상태를 기록한다.

1. 미배정 direct-ID 학생 1명 배정.
2. 미배정 custom-ID 학생 1명 배정 — `users/{uid}` 신규 생성 금지 assertion 포함.
3. 여러 custom/direct 학생 일괄 배정.
4. 반 이동과 복수 반 추가를 정책별로 분리.
5. 동일 반 재배정 idempotency.
6. 타 academy 배정 거부(academy 모델 도입 후).
7. 미존재 학생 doc ID.
8. 미존재 반 doc ID.
9. 관리자/강사/학생/비로그인 권한 matrix.
10. 정원 초과와 동시 관리자 2명(transaction 정책 도입 시).
11. 부분 실패 원자성 및 500/501건 chunk 경계.
12. commit 후 서버 재조회와 onSnapshot 반영.
13. 새로고침 유지.
14. legacy 파생 필드 및 class_members 정합성.
15. 중복 assignment/유령 uid 문서 생성 방지.
16. Trigger 실행 후 유지 — 현재 Trigger 0개임을 baseline으로 검증.
17. 로컬 Emulator Rules와 운영 배포 Rules hash/정책 동등성 검사.

운영에서는 쓰기 재현을 하지 말고, 배포 후 익명 canary 계정으로 최소 시나리오만 수행한다.

## 18. 최소수정안

1. `StudentLite`에 `docId`를 추가하고 hydrate 시 무조건 `snapshot.id`를 저장한다.
2. 서비스는 `{ studentDocId, uid }`를 받되 write ref는 오직 `studentDocId`로 만든다.
3. AccountSettings는 `doc(db, user.docPath)`를 반 변경에도 사용한다.
4. `classIds`를 Canonical로 정하고 현재 반 표시는 `classes` map에서 계산한다. `classId/className`은 당장 삭제하지 말고 read fallback으로만 유지한다.
5. commit 후 `getDocFromServer(users/{studentDocId})`로 classIds를 검증한 뒤 성공 UI를 표시한다.
6. 데이터 정리는 자동 덮어쓰지 않는다. 105개 불일치 쌍을 export/backup하고 타임스탬프·운영 정책으로 승자 값을 검토한 뒤 batch migration한다.
7. Rules는 별도 P0 변경으로 Emulator 테스트를 통과한 뒤 배포한다.

단일 학생의 단일 문서 변경에는 transaction이 필요 없다. 여러 학생 일괄 변경에는 현재처럼 writeBatch가 적합하되 500 미만 chunk와 부분 결과 정책이 필요하다. 반 정원이나 기존 배정 상태에 따라 허용 여부가 갈리면 해당 시점에 runTransaction이 필요하다.

## 19. 권장구조 개선안

현재 요구가 다중 반을 이미 지원하므로 단기 Canonical은 `users/{actualDocId}.classIds[]`가 가장 작은 변경이다. `classes.studentIds`, `class_members`, `classAssignments`를 동시에 원본으로 유지하지 않는다.

- Canonical: `users/{actualDocId}.classIds[]`.
- Identity: `docId`, `authUid`, `studentId`를 타입과 변수명에서 분리.
- Derived: 반별 학생 목록은 `users where classIds array-contains classId`; 이름은 `classes/{classId}.name` lookup.
- Legacy: `classId/className/isEnrolled/enrollmentStatus`는 단계적으로 파생 계산 또는 migration 후 제거.
- Audit: `enrollment_events`는 성공 commit과 같은 batch에 넣을 수 있으나 원본은 아님.
- Tenant: 다학원 요구가 실제로 생기면 `academies/{aid}/users|students|classes` 또는 모든 문서의 immutable `academyId`를 먼저 설계하고 Rules를 함께 바꾼다.
- 이력/과목/학기별 다중 배정이 필요하면 그때 `academies/{aid}/classAssignments/{id}`를 Canonical로 승격한다. 현재 0건인 collection을 장애 수정과 동시에 도입하지 않는다.

Cloud Function은 최소 ID-path 수정에는 필요 없다. 다만 운영자가 타 학생을 수정하는 보안 경계를 단순화하고 audit/정원/동시성 정책을 강제하려면 callable/HTTP 서버 계층으로 배정 명령을 이동하는 것이 권장된다. 현재 배포된 두 HTTPS Function은 계정 삭제 전용이며 배정과 무관하다.

## 20. 최종판정

- 핵심 장애: **CONFIRMED P0 — Document ID와 내부 uid 혼용으로 잘못된 `users/{uid}` 문서에 저장**.
- 저장/조회 위치: 논리 필드는 모두 `users.classIds`지만 물리 Document Path가 서로 달라 저장 위치와 조회 위치가 불일치한다.
- 현재 반 미표시: **CONFIRMED P1 코드 결함 — Canonical `classIds`와 표시용 `className` 갱신/조회 계약 불일치**.
- Security Rules: 현재 장애의 거부 원인은 아니나 운영 전면 허용은 **독립 P0**. 로컬 Rules는 운영과 불일치하며 활성 admin flow를 차단한다.
- Canonical Source: `users/{actualDocId}.classIds[]` 하나. `classId/className`은 legacy/파생, `class_members`와 `enrollment_events`는 보조, `classAssignments`는 미사용.
- 수정 착수 조건: RC1/RC2와 대상 파일은 확정됐다. 다만 운영 유령 문서 정리는 백업과 충돌 정책 승인 후 별도 실행해야 한다.
- writeBatch: 여러 학생·정리 migration에 필요. runTransaction: 현재 최소 수정에는 불필요, 정원/조건부 이동 정책 도입 시 필요.
- Cloud Function: 최소 수정에는 불필요; 보안·정책 중앙화를 위해 권장 가능.

