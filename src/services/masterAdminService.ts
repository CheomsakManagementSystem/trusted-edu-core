import {
  addDoc,
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type DocumentReference,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { normalizeRole, type CanonicalRole } from "@/lib/authz";
import { deleteManagedUserCompletely } from "@/services/accountDeletionService";

export { deleteManagedUserCompletely };

export const MASTER_ADMIN_CODE =
  "Admin_Master_#92!vXp7@K3nR5$tW6*bYc9uL1&qJ4^sE7%hG2_Z8mQ_A7xP9@L#2026_Secured";

const DEFAULT_INSTRUCTOR_SIGNUP_CODE =
  "A8z#mQ92!vXp7@K3nR5$tW6*bYc9uL1&qJ4^sE7%hG2(V0)Nf8_mZ1+pQ5#kR9";
const SYSTEM_SETTINGS_COLLECTION = "systemSettings";
const MASTER_CONTROLS_DOC_ID = "masterControls";
const MAX_BATCH_WRITES = 400;

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

const resolveUniqueManagedUserRef = async (uid: string): Promise<DocumentReference> => {
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
    throw new Error("사용자 문서를 찾을 수 없습니다.");
  }
  if (refs.size > 1) {
    throw new Error("동일한 인증 UID를 가진 사용자 문서가 여러 개여서 안전하게 수정할 수 없습니다.");
  }

  return Array.from(refs.values())[0];
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
  const userRef = await resolveUniqueManagedUserRef(uid);
  await setDoc(userRef, {
    role,
    updatedAt: serverTimestamp(),
  }, { merge: true });
};

export const updateManagedUserPhoneSuffix = async (
  uid: string,
  phoneSuffix: string,
): Promise<void> => {
  const userRef = await resolveUniqueManagedUserRef(uid);
  await setDoc(userRef, {
    phoneSuffix: phoneSuffix.trim() || null,
    updatedAt: serverTimestamp(),
  }, { merge: true });
};

export const cascadeUpdateStudentId = async (
  uid: string,
  oldStudentId: string,
  newStudentId: string,
): Promise<number> => {
  const userRef = await resolveUniqueManagedUserRef(uid);
  const normalized = newStudentId.trim() || null;

  let updatedCount = 0;
  if (oldStudentId) {
    const snap = await getDocs(
      query(collection(db, "reports"), where("studentId", "==", oldStudentId)),
    );

    for (const docs of chunkBy(snap.docs, MAX_BATCH_WRITES)) {
      const batch = writeBatch(db);
      docs.forEach((docSnap) => {
        batch.update(docSnap.ref, { studentId: normalized });
      });
      await batch.commit();
    }
    updatedCount = snap.docs.length;
  }

  await setDoc(userRef, {
    phoneSuffix: normalized,
    studentId: normalized,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  return updatedCount;
};

export const notifyDuplicatePhoneSuffixUsers = async (
  actorUid: string,
): Promise<{ notified: number; skipped: number }> => {
  const snap = await getDocs(collection(db, "users"));

  const suffixMap = new Map<string, { uid: string; name: string; docId: string }[]>();
  for (const docSnap of snap.docs) {
    const data = docSnap.data() as {
      uid?: string;
      name?: string;
      phoneSuffix?: string;
      isNotificationSent?: boolean;
    };
    const suffix = data.phoneSuffix?.trim();
    if (!suffix) continue;
    const entry = { uid: data.uid ?? docSnap.id, name: data.name ?? "", docId: docSnap.id };
    const list = suffixMap.get(suffix) ?? [];
    list.push(entry);
    suffixMap.set(suffix, list);
  }

  let notified = 0;
  let skipped = 0;

  for (const [, users] of suffixMap) {
    if (users.length < 2) continue;

    for (const u of users) {
      try {
        const userSnap = await getDoc(doc(db, "users", u.docId));
        if (userSnap.data()?.isNotificationSent === true) {
          skipped++;
          continue;
        }

        await addDoc(collection(db, "notifications"), {
          studentUid: u.uid,
          category: "DUPLICATE_ID_WARNING",
          title: "학생 ID 중복 안내",
          message:
            "[김윤환입시연구소] 안내: 회원님의 4자리 학생 ID가 다른 회원과 중복되어 있습니다. 대시보드 또는 마이페이지에서 즉시 ID를 변경해 주세요.",
          isRead: false,
          createdAt: serverTimestamp(),
          createdBy: actorUid,
        });

        await setDoc(doc(db, "users", u.docId), { isNotificationSent: true }, { merge: true });
        notified++;
      } catch (err) {
        console.error(`[notifyDuplicates] uid=${u.uid} 처리 실패`, err);
      }
    }
  }

  return { notified, skipped };
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
