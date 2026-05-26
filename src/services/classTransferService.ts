import {
  arrayRemove,
  arrayUnion,
  doc,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export type TransferClassTarget = {
  id: string;
  name: string;
} | null;

// ─── 단일 classId 기반 (하위 호환 유지) ─────────────────────────────────────

const buildAssignmentPayload = (targetClass: TransferClassTarget) => ({
  classId: targetClass?.id ?? null,
  className: targetClass?.name ?? null,
  isEnrolled: Boolean(targetClass),
  enrollmentStatus: targetClass ? "active" : null,
  updatedAt: serverTimestamp(),
});

export const updateStudentClassAssignment = async (
  studentUid: string,
  targetClass: TransferClassTarget,
) => {
  await updateDoc(doc(db, "users", studentUid), buildAssignmentPayload(targetClass));
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
    batch.update(doc(db, "users", studentUid), buildAssignmentPayload(targetClass));
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
  await updateDoc(doc(db, "users", studentUid), {
    classIds: arrayUnion(classId),
    updatedAt: serverTimestamp(),
  });
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
  await updateDoc(doc(db, "users", studentUid), {
    classIds: arrayRemove(classId),
    ...extra,
    updatedAt: serverTimestamp(),
  });
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
  await updateDoc(doc(db, "users", studentUid), {
    classIds: deduped,
    isEnrolled: deduped.length > 0,
    enrollmentStatus: deduped.length > 0 ? "active" : null,
    updatedAt: serverTimestamp(),
  });
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
    batch.update(doc(db, "users", studentUid), {
      classIds: arrayUnion(classId),
      isEnrolled: true,
      enrollmentStatus: "active",
      updatedAt: serverTimestamp(),
    });
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
    batch.update(doc(db, "users", studentUid), {
      classIds: deduped,
      isEnrolled: deduped.length > 0,
      enrollmentStatus: deduped.length > 0 ? "active" : null,
      updatedAt: serverTimestamp(),
    });
  });
  await batch.commit();
};
