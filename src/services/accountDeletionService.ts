import {
  EmailAuthProvider,
  deleteUser,
  reauthenticateWithCredential,
  type AuthError,
  type User,
} from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentReference,
  type Query,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { auth, db } from "@/lib/firebase";

type AccountDeletionStep = "reauth" | "firestore" | "auth";

export class AccountDeletionError extends Error {
  step: AccountDeletionStep;
  code?: string;

  constructor(message: string, step: AccountDeletionStep, code?: string) {
    super(message);
    this.name = "AccountDeletionError";
    this.step = step;
    this.code = code;
  }
}

const chunkBy = <T>(rows: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
};

const getAuthErrorCode = (error: unknown) => {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as AuthError).code)
    : "";
};

const resolveUniqueUserProfileRef = async (uid: string): Promise<DocumentReference> => {
  const normalizedUid = uid.trim();
  if (!normalizedUid) {
    throw new Error("사용자 식별값을 확인할 수 없습니다.");
  }

  const directRef = doc(db, "users", normalizedUid);
  const [directSnap, uidSnap] = await Promise.all([
    getDoc(directRef),
    getDocs(query(collection(db, "users"), where("uid", "==", normalizedUid))),
  ]);

  const refs = new Map<string, DocumentReference>();
  if (directSnap.exists()) {
    refs.set(directSnap.id, directSnap.ref);
  }
  uidSnap.docs.forEach((docSnap) => refs.set(docSnap.id, docSnap.ref));

  if (refs.size === 0) {
    throw new Error("사용자 프로필 문서를 찾을 수 없습니다.");
  }
  if (refs.size > 1) {
    throw new Error("동일한 인증 UID의 사용자 문서가 여러 개여서 자동 삭제를 중단했습니다.");
  }

  return Array.from(refs.values())[0];
};

const deleteDocumentsInQuery = async (targetQuery: Query) => {
  const snapshot = await getDocs(targetQuery);

  for (const docs of chunkBy(snapshot.docs, 400)) {
    const batch = writeBatch(db);
    docs.forEach((docSnap) => {
      batch.delete(docSnap.ref);
    });
    await batch.commit();
  }
};

const isolateStudentReports = async (studentUid: string) => {
  const reportsRef = collection(db, "reports");
  const snapshot = await getDocs(query(reportsRef, where("studentUid", "==", studentUid)));

  for (const docs of chunkBy(snapshot.docs, 400)) {
    const batch = writeBatch(db);
    docs.forEach((reportDoc) => {
      batch.update(reportDoc.ref, {
        studentUid: null,
        studentId: null,
        studentName: reportDoc.data().sourceName ?? "",
        assignmentStatus: "unassigned_pending",
        status: "pending",
        assignedAt: null,
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  }
};

const mapReauthError = (error: unknown) => {
  const code = getAuthErrorCode(error);

  switch (code) {
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return new AccountDeletionError(
        "비밀번호가 틀려 탈퇴 처리를 할 수 없습니다.",
        "reauth",
        code,
      );
    case "auth/too-many-requests":
      return new AccountDeletionError(
        "요청이 일시적으로 제한되었습니다. 잠시 후 다시 시도해 주세요.",
        "reauth",
        code,
      );
    default:
      return new AccountDeletionError(
        "재인증에 실패했습니다. 현재 비밀번호를 다시 확인해 주세요.",
        "reauth",
        code,
      );
  }
};

const mapFirestoreDeletionError = (error: unknown) => {
  return new AccountDeletionError(
    "서버 오류로 계정 삭제가 지연되고 있습니다. 관리자에게 문의하세요.",
    "firestore",
    getAuthErrorCode(error),
  );
};

const mapAuthDeletionError = (error: unknown) => {
  const code = getAuthErrorCode(error);

  switch (code) {
    case "auth/requires-recent-login":
      return new AccountDeletionError(
        "보안을 위해 다시 로그인한 뒤 탈퇴를 재시도해 주세요.",
        "auth",
        code,
      );
    default:
      return new AccountDeletionError(
        "인증 계정 삭제 단계에서 오류가 발생했습니다. 다시 시도해 주세요.",
        "auth",
        code,
      );
  }
};

export const getAccountDeletionErrorMessage = (error: unknown) => {
  if (error instanceof AccountDeletionError) {
    return error.message;
  }
  return error instanceof Error
    ? error.message
    : "탈퇴 처리 중 오류가 발생했습니다. 다시 시도해 주세요.";
};

export const reauthenticateCurrentUserForDeletion = async (password: string): Promise<User> => {
  const currentUser = auth.currentUser;

  if (!currentUser?.email) {
    throw new AccountDeletionError(
      "인증 정보를 확인할 수 없어 탈퇴를 진행할 수 없습니다.",
      "reauth",
    );
  }

  if (!password.trim()) {
    throw new AccountDeletionError(
      "보안을 위해 현재 비밀번호를 입력해 주세요.",
      "reauth",
    );
  }

  try {
    const credential = EmailAuthProvider.credential(currentUser.email, password);
    await reauthenticateWithCredential(currentUser, credential);
    return currentUser;
  } catch (error) {
    throw mapReauthError(error);
  }
};

export const purgeUserFirestoreData = async (uid: string): Promise<void> => {
  try {
    const profileRef = await resolveUniqueUserProfileRef(uid);

    await Promise.all([
      isolateStudentReports(uid),
      deleteDocumentsInQuery(query(collection(db, "classJoinRequests"), where("studentUid", "==", uid))),
      deleteDocumentsInQuery(query(collection(db, "submissions"), where("studentUid", "==", uid))),
      deleteDocumentsInQuery(query(collection(db, "notifications"), where("studentUid", "==", uid))),
      deleteDocumentsInQuery(query(collection(db, "class_members"), where("uid", "==", uid))),
      deleteDocumentsInQuery(query(collection(db, "enrollment_events"), where("uid", "==", uid))),
    ]);

    await deleteDoc(profileRef);
  } catch (error) {
    throw mapFirestoreDeletionError(error);
  }
};

export const deleteCurrentUserAccount = async (password: string): Promise<void> => {
  const currentUser = await reauthenticateCurrentUserForDeletion(password);

  await purgeUserFirestoreData(currentUser.uid);

  try {
    await deleteUser(currentUser);
  } catch (error) {
    throw mapAuthDeletionError(error);
  }
};

const extractFunctionErrorText = async (response: Response) => {
  try {
    const payload = (await response.json()) as { reason?: string };
    return payload.reason || "";
  } catch {
    return await response.text().catch(() => "");
  }
};

const invokeOnRequestFunction = async (fnName: string, uid: string): Promise<void> => {
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  const region = import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || "us-central1";
  const currentUser = auth.currentUser;

  if (!projectId) {
    throw new AccountDeletionError(
      "Firebase 프로젝트 설정을 찾지 못해 계정 삭제를 완료할 수 없습니다.",
      "auth",
    );
  }
  if (!currentUser) {
    throw new AccountDeletionError(
      "관리자 로그인 정보를 확인할 수 없습니다.",
      "auth",
    );
  }

  const idToken = await currentUser.getIdToken();
  const endpoint = `https://${region}-${projectId}.cloudfunctions.net/${fnName}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ uid, action: "delete" }),
  });

  if (!response.ok) {
    const message = await extractFunctionErrorText(response);
    throw new AccountDeletionError(
      message || "관리자 인증 계정 삭제 요청이 실패했습니다.",
      "auth",
    );
  }
};

export const deleteAuthUserByUid = async (uid: string): Promise<void> => {
  const functions = getFunctions();
  const functionNames = ["adminDeleteUser", "deleteUserByUid"];

  for (const fnName of functionNames) {
    try {
      await invokeOnRequestFunction(fnName, uid);
      return;
    } catch {
      // 배포 환경 차이를 위해 callable 형식도 이어서 시도한다.
    }

    try {
      const callable = httpsCallable<{ uid: string; action: "delete" }, { ok?: boolean }>(
        functions,
        fnName,
      );
      await callable({ uid, action: "delete" });
      return;
    } catch {
      continue;
    }
  }

  throw new AccountDeletionError(
    "관리자용 Auth 계정 삭제 함수가 준비되지 않았습니다. Firebase Functions를 배포해주세요.",
    "auth",
  );
};

export const deleteManagedUserCompletely = async (uid: string): Promise<void> => {
  await deleteAuthUserByUid(uid);
  await purgeUserFirestoreData(uid);
};

export const clearClientSession = async (signOut?: () => Promise<void>) => {
  try {
    if (signOut) {
      await signOut();
    } else {
      await auth.signOut();
    }
  } catch {
    // 서버에서 세션이 먼저 무효화된 경우를 허용
  }

  window.localStorage.clear();
  window.sessionStorage.clear();
};
