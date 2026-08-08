import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  documentId,
  getDocFromServer,
  getDocsFromServer,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type WriteBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

const MAX_BATCH_WRITES = 450;
const MAX_IN_QUERY_VALUES = 30;

export type TransferClassTarget = {
  id: string;
  name: string;
} | null;

export type StudentDocumentTarget = {
  docId: string;
  uid?: string | null;
};

export type JoinClassStudent = StudentDocumentTarget & {
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

const requireStudentDocId = (student: StudentDocumentTarget): string => {
  const docId = student.docId.trim();
  if (!docId) {
    throw new Error("학생 문서 정보를 확인할 수 없습니다.");
  }
  return docId;
};

export const buildStudentDocumentPath = (student: StudentDocumentTarget) =>
  `users/${requireStudentDocId(student)}`;

const getStudentRef = (student: StudentDocumentTarget) =>
  doc(db, buildStudentDocumentPath(student));

const sameClassIds = (left: string[], right: string[]) => {
  const a = Array.from(new Set(left)).sort();
  const b = Array.from(new Set(right)).sort();
  return JSON.stringify(a) === JSON.stringify(b);
};

const matchesExpectedClassIds = (
  classIds: string[],
  expected: string[] | ((classIds: string[]) => boolean),
) => (typeof expected === "function" ? expected(classIds) : sameClassIds(classIds, expected));

const verifyStudentClassIds = async (
  student: StudentDocumentTarget,
  expected: string[] | ((classIds: string[]) => boolean),
): Promise<void> => {
  const snapshot = await getDocFromServer(getStudentRef(student));
  if (!snapshot.exists()) {
    throw new Error(`학생 문서를 찾을 수 없습니다: users/${requireStudentDocId(student)}`);
  }

  const data = snapshot.data() as { classIds?: unknown; classId?: string | null };
  const classIds = normalizeClassIds(data.classIds, data.classId ?? null);
  if (!matchesExpectedClassIds(classIds, expected)) {
    throw new Error("반 정보 저장 후 서버 검증에 실패했습니다. 새로고침 후 다시 시도해주세요.");
  }
};

const verifyStudentClassIdsInBatches = async (
  students: StudentDocumentTarget[],
  expected: string[] | ((classIds: string[]) => boolean),
): Promise<void> => {
  if (!students.length) return;

  const uniqueStudents = Array.from(
    new Map(students.map((student) => [requireStudentDocId(student), student])).values(),
  );
  const chunks: StudentDocumentTarget[][] = [];
  for (let start = 0; start < uniqueStudents.length; start += MAX_IN_QUERY_VALUES) {
    chunks.push(uniqueStudents.slice(start, start + MAX_IN_QUERY_VALUES));
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      const docIds = chunk.map(requireStudentDocId);
      const snapshot = await getDocsFromServer(
        query(collection(db, "users"), where(documentId(), "in", docIds)),
      );
      const dataById = new Map(
        snapshot.docs.map((docSnap) => [
          docSnap.id,
          docSnap.data() as { classIds?: unknown; classId?: string | null },
        ]),
      );

      for (const student of chunk) {
        const docId = requireStudentDocId(student);
        const data = dataById.get(docId);
        if (!data) {
          throw new Error(`학생 문서를 찾을 수 없습니다: users/${docId}`);
        }
        const classIds = normalizeClassIds(data.classIds, data.classId ?? null);
        if (!matchesExpectedClassIds(classIds, expected)) {
          throw new Error("반 정보 저장 후 서버 검증에 실패했습니다. 새로고침 후 다시 시도해주세요.");
        }
      }
    }),
  );
};

const commitInChunks = async (
  students: StudentDocumentTarget[],
  addWrites: (batch: WriteBatch, student: StudentDocumentTarget) => void,
): Promise<void> => {
  for (let start = 0; start < students.length; start += MAX_BATCH_WRITES) {
    const chunk = students.slice(start, start + MAX_BATCH_WRITES);
    const batch = writeBatch(db);
    chunk.forEach((student) => addWrites(batch, student));
    await batch.commit();
  }
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
  const userRef = getStudentRef(student);
  const eventRef = doc(collection(db, "enrollment_events"));

  batch.set(memberRef, {
    classId: targetClass.id,
    className: targetClass.name ?? null,
    uid: student.uid,
    studentName: student.name ?? null,
    studentEmail: student.email ?? null,
    createdAt: serverTimestamp(),
  }, { merge: true });

  batch.update(userRef, {
    classIds: arrayUnion(targetClass.id),
    isEnrolled: true,
    enrollmentStatus: "active",
    updatedAt: serverTimestamp(),
  });

  batch.set(eventRef, {
    type: "class_joined",
    classId: targetClass.id,
    uid: student.uid,
    createdAt: serverTimestamp(),
  });

  await batch.commit();
  await verifyStudentClassIds(student, (classIds) => classIds.includes(targetClass.id));
};

// ─── 단일 대표 반 기반 하위 호환 필드 동기화 ───────────────────────────────

export const syncClassFields = (targetClass: TransferClassTarget) => {
  const classIds = targetClass ? [targetClass.id] : [];
  return {
    classId: targetClass?.id ?? null,
    className: targetClass?.name ?? null,
    classIds,
    isEnrolled: classIds.length > 0,
    enrollmentStatus: classIds.length > 0 ? "active" : null,
    updatedAt: serverTimestamp(),
  };
};

export const updateStudentClassAssignment = async (
  student: StudentDocumentTarget,
  targetClass: TransferClassTarget,
): Promise<void> => {
  await updateDoc(getStudentRef(student), syncClassFields(targetClass));
  await verifyStudentClassIds(student, targetClass ? [targetClass.id] : []);
};

export const bulkUpdateStudentClassAssignments = async (
  students: StudentDocumentTarget[],
  targetClass: TransferClassTarget,
): Promise<void> => {
  if (!students.length) return;
  await commitInChunks(students, (batch, student) => {
    batch.update(getStudentRef(student), syncClassFields(targetClass));
  });
  await verifyStudentClassIdsInBatches(students, targetClass ? [targetClass.id] : []);
};

// ─── classIds[] 배열 기반 다중 반 지원 ─────────────────────────────────────

export const addClassIdToStudent = async (
  student: StudentDocumentTarget,
  classId: string,
): Promise<void> => {
  await updateDoc(getStudentRef(student), {
    classIds: arrayUnion(classId),
    isEnrolled: true,
    enrollmentStatus: "active",
    updatedAt: serverTimestamp(),
  });
  await verifyStudentClassIds(student, (classIds) => classIds.includes(classId));
};

export const removeClassIdFromStudent = async (
  student: StudentDocumentTarget,
  classId: string,
  remainingClassIds: string[],
  primaryClass: TransferClassTarget,
): Promise<void> => {
  const isEnrolled = remainingClassIds.length > 0;
  await updateDoc(getStudentRef(student), {
    classIds: arrayRemove(classId),
    classId: primaryClass?.id ?? null,
    className: primaryClass?.name ?? null,
    isEnrolled,
    enrollmentStatus: isEnrolled ? "active" : null,
    updatedAt: serverTimestamp(),
  });
  await verifyStudentClassIds(student, (classIds) => !classIds.includes(classId));
};

export const updateStudentClassIds = async (
  student: StudentDocumentTarget,
  classIds: string[],
  primaryClass: TransferClassTarget,
): Promise<void> => {
  const deduped = Array.from(new Set(classIds.filter(Boolean)));
  await updateDoc(getStudentRef(student), {
    classIds: deduped,
    classId: primaryClass?.id ?? null,
    className: primaryClass?.name ?? null,
    isEnrolled: deduped.length > 0,
    enrollmentStatus: deduped.length > 0 ? "active" : null,
    updatedAt: serverTimestamp(),
  });
  await verifyStudentClassIds(student, deduped);
};

export const bulkAddClassIdToStudents = async (
  students: StudentDocumentTarget[],
  classId: string,
): Promise<void> => {
  if (!students.length) return;
  await commitInChunks(students, (batch, student) => {
    batch.update(getStudentRef(student), {
      classIds: arrayUnion(classId),
      isEnrolled: true,
      enrollmentStatus: "active",
      updatedAt: serverTimestamp(),
    });
  });
  await verifyStudentClassIdsInBatches(
    students,
    (classIds) => classIds.includes(classId),
  );
};

export const bulkUpdateStudentClassIds = async (
  students: StudentDocumentTarget[],
  classIds: string[],
  primaryClass: TransferClassTarget,
): Promise<void> => {
  if (!students.length) return;
  const deduped = Array.from(new Set(classIds.filter(Boolean)));
  await commitInChunks(students, (batch, student) => {
    batch.update(getStudentRef(student), {
      classIds: deduped,
      classId: primaryClass?.id ?? null,
      className: primaryClass?.name ?? null,
      isEnrolled: deduped.length > 0,
      enrollmentStatus: deduped.length > 0 ? "active" : null,
      updatedAt: serverTimestamp(),
    });
  });
  await verifyStudentClassIdsInBatches(students, deduped);
};
