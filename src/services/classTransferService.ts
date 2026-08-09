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
  type DocumentData,
  type DocumentReference,
  type QueryDocumentSnapshot,
  type WriteBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

const MAX_BATCH_WRITES = 450;
const MAX_IN_QUERY_VALUES = 30;

export type TransferClassTarget = {
  id: string;
  name: string | null;
} | null;

export type ClassReference = {
  id: string;
  name: string;
};

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

export const resolvePrimaryClassId = (
  classIds: unknown,
  legacyClassId?: string | null,
): string | null => {
  const normalized = normalizeClassIds(classIds, legacyClassId);
  if (legacyClassId && normalized.includes(legacyClassId)) {
    return legacyClassId;
  }
  return normalized[0] ?? null;
};

export const shouldSyncRenamedPrimaryClassName = (
  classIds: unknown,
  legacyClassId: string | null | undefined,
  renamedClassId: string,
) => resolvePrimaryClassId(classIds, legacyClassId) === renamedClassId;

export const resolveClassStateAfterRemoval = (
  classIds: unknown,
  legacyClassId: string | null | undefined,
  removedClassId: string,
  classes: ClassReference[],
): { classIds: string[]; primaryClass: TransferClassTarget } => {
  const remainingClassIds = normalizeClassIds(classIds, legacyClassId).filter(
    (classId) => classId !== removedClassId,
  );
  const currentPrimaryClassId = resolvePrimaryClassId(classIds, legacyClassId);
  const primaryClassId =
    currentPrimaryClassId && remainingClassIds.includes(currentPrimaryClassId)
      ? currentPrimaryClassId
      : remainingClassIds[0] ?? null;

  if (!primaryClassId) {
    return { classIds: remainingClassIds, primaryClass: null };
  }

  const matchedClass = classes.find((item) => item.id === primaryClassId);
  return {
    classIds: remainingClassIds,
    primaryClass: {
      id: primaryClassId,
      name: matchedClass?.name ?? null,
    },
  };
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

const commitDocumentRefsInChunks = async (
  refs: DocumentReference[],
  addWrites: (batch: WriteBatch, ref: DocumentReference) => void,
): Promise<void> => {
  for (let start = 0; start < refs.length; start += MAX_BATCH_WRITES) {
    const batch = writeBatch(db);
    refs.slice(start, start + MAX_BATCH_WRITES).forEach((ref) => addWrites(batch, ref));
    await batch.commit();
  }
};

const getUserDocumentsForClass = async (
  classId: string,
): Promise<QueryDocumentSnapshot<DocumentData>[]> => {
  const [arraySnapshot, primarySnapshot] = await Promise.all([
    getDocsFromServer(query(collection(db, "users"), where("classIds", "array-contains", classId))),
    getDocsFromServer(query(collection(db, "users"), where("classId", "==", classId))),
  ]);

  const unique = new Map<string, QueryDocumentSnapshot<DocumentData>>();
  [...arraySnapshot.docs, ...primarySnapshot.docs].forEach((docSnap) => {
    unique.set(docSnap.id, docSnap);
  });
  return Array.from(unique.values());
};

export const syncRenamedClassReferences = async (
  classId: string,
  className: string,
): Promise<{ studentCount: number; memberCount: number }> => {
  const [studentDocs, memberSnapshot] = await Promise.all([
    getUserDocumentsForClass(classId),
    getDocsFromServer(query(collection(db, "class_members"), where("classId", "==", classId))),
  ]);

  const primaryStudentRefs = studentDocs
    .filter((studentDoc) => {
      const data = studentDoc.data() as { classIds?: unknown; classId?: string | null };
      return shouldSyncRenamedPrimaryClassName(data.classIds, data.classId, classId);
    })
    .map((studentDoc) => studentDoc.ref);

  await Promise.all([
    commitDocumentRefsInChunks(primaryStudentRefs, (batch, ref) => {
      batch.update(ref, {
        className,
        updatedAt: serverTimestamp(),
      });
    }),
    commitDocumentRefsInChunks(memberSnapshot.docs.map((docSnap) => docSnap.ref), (batch, ref) => {
      batch.update(ref, {
        className,
        updatedAt: serverTimestamp(),
      });
    }),
  ]);

  return {
    studentCount: primaryStudentRefs.length,
    memberCount: memberSnapshot.docs.length,
  };
};

export const removeDeletedClassReferences = async (
  classId: string,
  classes: ClassReference[],
): Promise<{ studentCount: number; memberCount: number }> => {
  const [studentDocs, memberSnapshot] = await Promise.all([
    getUserDocumentsForClass(classId),
    getDocsFromServer(query(collection(db, "class_members"), where("classId", "==", classId))),
  ]);

  for (let start = 0; start < studentDocs.length; start += MAX_BATCH_WRITES) {
    const batch = writeBatch(db);
    studentDocs.slice(start, start + MAX_BATCH_WRITES).forEach((studentDoc) => {
      const data = studentDoc.data() as { classIds?: unknown; classId?: string | null };
      const next = resolveClassStateAfterRemoval(data.classIds, data.classId, classId, classes);
      const isEnrolled = next.classIds.length > 0;
      batch.update(studentDoc.ref, {
        classIds: next.classIds,
        classId: next.primaryClass?.id ?? null,
        className: next.primaryClass?.name ?? null,
        isEnrolled,
        enrollmentStatus: isEnrolled ? "active" : null,
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  }

  await commitDocumentRefsInChunks(memberSnapshot.docs.map((docSnap) => docSnap.ref), (batch, ref) => {
    batch.delete(ref);
  });

  return {
    studentCount: studentDocs.length,
    memberCount: memberSnapshot.docs.length,
  };
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
