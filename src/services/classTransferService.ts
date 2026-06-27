import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export type TransferClassTarget = {
  id: string;
  name: string;
} | null;

export type JoinClassStudent = {
  uid: string;
  name?: string | null;
  email?: string | null;
};

export type JoinClassTarget = {
  id: string;
  name?: string | null;
};

export const buildClassMemberId = (classId: string, uid: string) => `${classId}_${uid}`;

export const normalizeClassIds = (
  classIds: unknown,
  legacyClassId?: string | null,
): string[] => {
  const ids = Array.isArray(classIds)
    ? classIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];

  if (ids.length > 0) {
    return Array.from(new Set(ids));
  }

  return legacyClassId ? [legacyClassId] : [];
};

export const joinClass = async (
  student: JoinClassStudent,
  targetClass: JoinClassTarget,
): Promise<void> => {
  if (!student.uid) {
    throw new Error("사용자 정보를 확인할 수 없습니다.");
  }

  if (!targetClass.id) {
    throw new Error("반 정보를 확인할 수 없습니다.");
  }

  const batch = writeBatch(db);
  const memberId = buildClassMemberId(targetClass.id, student.uid);
  const memberRef = doc(db, "class_members", memberId);
  const userRef = doc(db, "users", student.uid);
  const eventRef = doc(collection(db, "enrollment_events"));

  console.log("Updating document at:", memberRef.path);
  console.log("Updating document at:", userRef.path);
  console.log("Updating document at:", eventRef.path);

  batch.set(memberRef, {
    classId: targetClass.id,
    className: targetClass.name ?? null,
    uid: student.uid,
    studentName: student.name ?? null,
    studentEmail: student.email ?? null,
    createdAt: serverTimestamp(),
  }, { merge: true });

  batch.set(userRef, {
    classIds: arrayUnion(targetClass.id),
  }, { merge: true });

  batch.set(eventRef, {
    type: "class_joined",
    classId: targetClass.id,
    uid: student.uid,
    createdAt: serverTimestamp(),
  });

  await batch.commit();
};

// ─── 단일 classId 기반 (하위 호환 유지) ─────────────────────────────────────

export const syncClassFields = (targetClass: TransferClassTarget) => {
  if (!targetClass) {
    return {
      classId: null,
      className: null,
      classIds: [],
      isEnrolled: false,
      enrollmentStatus: null,
      updatedAt: serverTimestamp(),
    };
  }

  return {
    classId: targetClass.id,
    className: targetClass.name,
    classIds: arrayUnion(targetClass.id),
    isEnrolled: true,
    enrollmentStatus: "active",
    updatedAt: serverTimestamp(),
  };
};

export const updateStudentClassAssignment = async (
  studentUid: string,
  targetClass: TransferClassTarget,
) => {
  await setDoc(doc(db, "users", studentUid), syncClassFields(targetClass), { merge: true });
};

export const bulkUpdateStudentClassAssignments = async (
  studentUids: string[],
  targetClass: TransferClassTarget,
) => {
  if (!studentUids.length) {
    return;
  }

  const batch = writeBatch(db);
  studentUids.forEach((studentUid) => {
    if (!studentUid) {
      console.error("[BulkAssign] studentUid 누락으로 업데이트 제외:", {
        studentUid,
        targetClass,
      });
      return;
    }

    console.log("[BulkAssign] users document id 확인:", studentUid);
    batch.update(doc(db, "users", studentUid), syncClassFields(targetClass));
  });
  await batch.commit();
};

// ─── classIds[] 배열 기반 (다중 반 지원) ────────────────────────────────────

/**
 * 학생의 classIds 배열에 하나의 classId를 추가한다.
 * arrayUnion 으로 Firestore 원자적 중복 차단.
 */
export const addClassIdToStudent = async (
  studentUid: string,
  classId: string,
): Promise<void> => {
  await setDoc(doc(db, "users", studentUid), {
    classIds: arrayUnion(classId),
    updatedAt: serverTimestamp(),
  }, { merge: true });
};

/**
 * 학생의 classIds 배열에서 특정 classId를 제거한다.
 * classIds 가 비어지면 isEnrolled / enrollmentStatus 도 초기화.
 */
export const removeClassIdFromStudent = async (
  studentUid: string,
  classId: string,
  remainingCount: number,
): Promise<void> => {
  const extra =
    remainingCount <= 1
      ? { isEnrolled: false, enrollmentStatus: null }
      : {};
  await setDoc(doc(db, "users", studentUid), {
    classIds: arrayRemove(classId),
    ...extra,
    updatedAt: serverTimestamp(),
  }, { merge: true });
};

/**
 * 학생의 classIds 배열 전체를 교체한다 (관리 섹션 저장 시).
 * 중복 제거는 호출 전 Set 으로 보장.
 */
export const updateStudentClassIds = async (
  studentUid: string,
  classIds: string[],
): Promise<void> => {
  const deduped = Array.from(new Set(classIds.filter(Boolean)));
  await setDoc(doc(db, "users", studentUid), {
    classIds: deduped,
    isEnrolled: deduped.length > 0,
    enrollmentStatus: deduped.length > 0 ? "active" : null,
    updatedAt: serverTimestamp(),
  }, { merge: true });
};

/**
 * 여러 학생의 classIds 에 동일한 classId 를 일괄 추가한다.
 */
export const bulkAddClassIdToStudents = async (
  studentUids: string[],
  classId: string,
): Promise<void> => {
  if (!studentUids.length) {
    return;
  }

  const batch = writeBatch(db);
  studentUids.forEach((studentUid) => {
    batch.set(doc(db, "users", studentUid), {
      classIds: arrayUnion(classId),
      isEnrolled: true,
      enrollmentStatus: "active",
      updatedAt: serverTimestamp(),
    }, { merge: true });
  });
  await batch.commit();
};

/**
 * 여러 학생의 classIds 를 새 배열로 일괄 교체한다 (일괄 변경 모달 저장 시).
 */
export const bulkUpdateStudentClassIds = async (
  studentUids: string[],
  classIds: string[],
): Promise<void> => {
  if (!studentUids.length) {
    return;
  }

  const deduped = Array.from(new Set(classIds.filter(Boolean)));
  const batch = writeBatch(db);
  studentUids.forEach((studentUid) => {
    batch.set(doc(db, "users", studentUid), {
      classIds: deduped,
      isEnrolled: deduped.length > 0,
      enrollmentStatus: deduped.length > 0 ? "active" : null,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  });
  await batch.commit();
};
