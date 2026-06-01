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
  updateDoc,
  where,
  writeBatch,
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

export const updateManagedUserPhoneSuffix = async (
  uid: string,
  phoneSuffix: string,
): Promise<void> => {
  await updateDoc(doc(db, "users", uid), {
    phoneSuffix: phoneSuffix.trim() || null,
    updatedAt: serverTimestamp(),
  });
};

/** 학생 식별 ID 강제 수정 + 연동 리포트 일괄 cascade update (단일 writeBatch) */
export const cascadeUpdateStudentId = async (
  uid: string,
  oldStudentId: string,
  newStudentId: string,
): Promise<number> => {
  const batch = writeBatch(db);
  const normalized = newStudentId.trim() || null;

  batch.update(doc(db, "users", uid), {
    phoneSuffix: normalized,
    studentId: normalized,
    updatedAt: serverTimestamp(),
  });

  let updatedCount = 0;
  if (oldStudentId) {
    const snap = await getDocs(
      query(collection(db, "reports"), where("studentId", "==", oldStudentId)),
    );
    snap.docs.forEach((docSnap) => {
      batch.update(docSnap.ref, { studentId: normalized });
    });
    updatedCount = snap.docs.length;
  }

  await batch.commit();
  return updatedCount;
};

/**
 * users 컬렉션 전수 스캔 → phoneSuffix 중복 대상에게 인앱 알림 발송
 * isNotificationSent: true 플래그로 재발송 방지
 */
export const notifyDuplicatePhoneSuffixUsers = async (
  actorUid: string,
): Promise<{ notified: number; skipped: number }> => {
  const snap = await getDocs(collection(db, "users"));

  // phoneSuffix별 uid 목록 집계
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
        // 이미 발송된 유저 스킵
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

        await updateDoc(doc(db, "users", u.docId), { isNotificationSent: true });
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
