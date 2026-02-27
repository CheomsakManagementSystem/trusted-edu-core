import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "@/lib/firebase";
import { normalizeRole, type CanonicalRole } from "@/lib/authz";

export const MASTER_ADMIN_CODE =
  "Admin_Master_#92!vXp7@K3nR5$tW6*bYc9uL1&qJ4^sE7%hG2_Z8mQ_A7xP9@L#2026_Secured";

const DEFAULT_INSTRUCTOR_SIGNUP_CODE =
  "A8z#mQ92!vXp7@K3nR5$tW6*bYc9uL1&qJ4^sE7%hG2(V0)Nf8_mZ1+pQ5#kR9";
const SYSTEM_SETTINGS_COLLECTION = "systemSettings";
const MASTER_CONTROLS_DOC_ID = "masterControls";

export type MasterControls = {
  instructorSignupCode: string;
  autoNotifyOnFeedbackComplete: boolean;
  updatedAt?: unknown;
  updatedBy?: string;
};

export type ManagedUser = {
  uid: string;
  name: string;
  email: string;
  role: CanonicalRole;
  studentId?: string | null;
  phoneSuffix?: string | null;
};

const chunkBy = <T>(rows: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
};

const controlsRef = doc(db, SYSTEM_SETTINGS_COLLECTION, MASTER_CONTROLS_DOC_ID);

export const getMasterControls = async (): Promise<MasterControls> => {
  const snap = await getDoc(controlsRef);

  if (!snap.exists()) {
    return {
      instructorSignupCode: DEFAULT_INSTRUCTOR_SIGNUP_CODE,
      autoNotifyOnFeedbackComplete: true,
    };
  }

  const data = snap.data() as Partial<MasterControls>;

  return {
    instructorSignupCode: data.instructorSignupCode || DEFAULT_INSTRUCTOR_SIGNUP_CODE,
    autoNotifyOnFeedbackComplete: Boolean(data.autoNotifyOnFeedbackComplete),
    updatedAt: data.updatedAt,
    updatedBy: data.updatedBy,
  };
};

export const saveMasterControls = async (
  payload: Pick<MasterControls, "instructorSignupCode" | "autoNotifyOnFeedbackComplete">,
  updatedBy: string,
): Promise<void> => {
  await setDoc(
    controlsRef,
    {
      instructorSignupCode: payload.instructorSignupCode,
      autoNotifyOnFeedbackComplete: payload.autoNotifyOnFeedbackComplete,
      updatedAt: serverTimestamp(),
      updatedBy,
    },
    { merge: true },
  );
};

export const fetchManagedUsers = async (): Promise<ManagedUser[]> => {
  try {
    const snap = await getDocs(query(collection(db, "users"), orderBy("name", "asc")));

    return snap.docs.map((docSnap) => {
      const data = docSnap.data() as {
        uid?: string;
        name?: string;
        email?: string;
        role?: string;
        studentId?: string;
        phoneSuffix?: string;
      };

      return {
        uid: data.uid ?? docSnap.id,
        name: data.name ?? "이름 없음",
        email: data.email ?? "",
        role: normalizeRole(data.role),
        studentId: data.studentId ?? null,
        phoneSuffix: data.phoneSuffix ?? null,
      };
    });
  } catch {
    const snap = await getDocs(collection(db, "users"));

    return snap.docs
      .map((docSnap) => {
        const data = docSnap.data() as {
          uid?: string;
          name?: string;
          email?: string;
          role?: string;
          studentId?: string;
          phoneSuffix?: string;
        };

        return {
          uid: data.uid ?? docSnap.id,
          name: data.name ?? "이름 없음",
          email: data.email ?? "",
          role: normalizeRole(data.role),
          studentId: data.studentId ?? null,
          phoneSuffix: data.phoneSuffix ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }
};

export const updateManagedUserRole = async (
  uid: string,
  role: Extract<CanonicalRole, "STUDENT" | "INSTRUCTOR">,
): Promise<void> => {
  await updateDoc(doc(db, "users", uid), {
    role,
    updatedAt: serverTimestamp(),
  });
};

const deleteDocumentsInQuery = async (targetQuery: ReturnType<typeof query>) => {
  const snapshot = await getDocs(targetQuery);

  for (const docs of chunkBy(snapshot.docs, 400)) {
    const batch = writeBatch(db);
    docs.forEach((docSnap) => {
      batch.delete(docSnap.ref);
    });
    await batch.commit();
  }
};

const deleteAuthUserByUid = async (uid: string): Promise<void> => {
  const functions = getFunctions();
  const functionNames = ["adminDeleteUser", "deleteUserByUid"];

  for (const fnName of functionNames) {
    try {
      const callable = httpsCallable<{ uid: string }, { ok?: boolean }>(functions, fnName);
      await callable({ uid });
      return;
    } catch {
      continue;
    }
  }

  throw new Error(
    "Auth 계정 삭제 함수(adminDeleteUser 또는 deleteUserByUid)를 찾지 못했습니다. Firebase Functions를 먼저 배포해주세요.",
  );
};

export const deleteManagedUserCompletely = async (uid: string): Promise<void> => {
  await deleteAuthUserByUid(uid);

  await Promise.all([
    deleteDocumentsInQuery(query(collection(db, "reports"), where("studentUid", "==", uid))),
    deleteDocumentsInQuery(query(collection(db, "reports"), where("uid", "==", uid))),
    deleteDocumentsInQuery(query(collection(db, "classJoinRequests"), where("studentUid", "==", uid))),
    deleteDocumentsInQuery(query(collection(db, "submissions"), where("studentUid", "==", uid))),
    deleteDocumentsInQuery(query(collection(db, "notifications"), where("studentUid", "==", uid))),
  ]);

  await deleteDoc(doc(db, "users", uid));
};

export const enqueueReportNotifications = async (
  reportIds: string[],
  actorUid: string,
): Promise<number> => {
  if (!reportIds.length) {
    return 0;
  }

  let created = 0;

  for (const ids of chunkBy(reportIds, 10)) {
    const reportSnap = await getDocs(
      query(collection(db, "reports"), where(documentId(), "in", ids)),
    );

    for (const reportDoc of reportSnap.docs) {
      const data = reportDoc.data() as {
        studentUid?: string | null;
        studentName?: string;
        essayTopic?: string;
      };

      if (!data.studentUid) {
        continue;
      }

      await addDoc(collection(db, "notifications"), {
        studentUid: data.studentUid,
        reportId: reportDoc.id,
        category: "REPORT_COMPLETED",
        title: "첨삭이 도착했습니다",
        message: `${data.studentName || "학생"}님의 '${data.essayTopic || "리포트"}' 첨삭이 완료되었습니다.`,
        isRead: false,
        createdAt: serverTimestamp(),
        createdBy: actorUid,
      });
      created += 1;
    }
  }

  return created;
};
