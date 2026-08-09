import {
  collection,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { normalizeClassIds } from "@/services/classTransferService";

const MAX_BATCH_WRITES = 400;

export type ClassIdentity = {
  id: string;
  name: string;
};

export type ClassStateAfterRemoval = {
  classIds: string[];
  classId: string | null;
  className: string | null;
};

const uniqueDocs = <T extends DocumentSnapshot>(docs: T[]) =>
  Array.from(new Map(docs.map((docSnap) => [docSnap.id, docSnap])).values());

const commitInChunks = async <T>(
  rows: T[],
  addWrites: (batch: ReturnType<typeof writeBatch>, row: T) => void,
) => {
  for (let start = 0; start < rows.length; start += MAX_BATCH_WRITES) {
    const batch = writeBatch(db);
    rows.slice(start, start + MAX_BATCH_WRITES).forEach((row) => addWrites(batch, row));
    await batch.commit();
  }
};

export const shouldSyncPrimaryClassName = (
  primaryClassId: string | null | undefined,
  renamedClassId: string,
) => primaryClassId === renamedClassId;

export const resolveClassStateAfterRemoval = (
  classIds: unknown,
  currentPrimaryClassId: string | null | undefined,
  removedClassId: string,
  classes: ClassIdentity[],
): ClassStateAfterRemoval => {
  const currentIds = normalizeClassIds(classIds, currentPrimaryClassId ?? null);
  const nextIds = currentIds.filter((id) => id !== removedClassId);

  const preservedPrimary =
    currentPrimaryClassId &&
    currentPrimaryClassId !== removedClassId &&
    nextIds.includes(currentPrimaryClassId)
      ? currentPrimaryClassId
      : null;
  const nextPrimaryId = preservedPrimary ?? nextIds[0] ?? null;
  const nextPrimaryName =
    nextPrimaryId ? classes.find((item) => item.id === nextPrimaryId)?.name ?? null : null;

  return {
    classIds: nextIds,
    classId: nextPrimaryId,
    className: nextPrimaryName,
  };
};

const fetchStudentsForClass = async (classId: string) => {
  const usersRef = collection(db, "users");
  const [classIdsSnap, primaryClassSnap] = await Promise.all([
    getDocs(query(usersRef, where("classIds", "array-contains", classId))),
    getDocs(query(usersRef, where("classId", "==", classId))),
  ]);

  return uniqueDocs([...classIdsSnap.docs, ...primaryClassSnap.docs]);
};

export const renameClassReferences = async (classId: string, className: string): Promise<void> => {
  const [students, memberSnap] = await Promise.all([
    fetchStudentsForClass(classId),
    getDocs(query(collection(db, "class_members"), where("classId", "==", classId))),
  ]);

  const primaryStudents = students.filter((studentDoc) => {
    const data = studentDoc.data() as { classId?: string | null };
    return shouldSyncPrimaryClassName(data.classId, classId);
  });

  await commitInChunks(primaryStudents, (batch, studentDoc) => {
    batch.update(studentDoc.ref, {
      className,
      updatedAt: serverTimestamp(),
    });
  });

  await commitInChunks(memberSnap.docs, (batch, memberDoc) => {
    batch.update(memberDoc.ref, {
      className,
      updatedAt: serverTimestamp(),
    });
  });
};

export const removeClassReferences = async (
  classId: string,
  classes: ClassIdentity[],
): Promise<void> => {
  const [students, memberSnap] = await Promise.all([
    fetchStudentsForClass(classId),
    getDocs(query(collection(db, "class_members"), where("classId", "==", classId))),
  ]);

  await commitInChunks(students, (batch, studentDoc) => {
    const data = studentDoc.data() as {
      classIds?: unknown;
      classId?: string | null;
    };
    const next = resolveClassStateAfterRemoval(
      data.classIds,
      data.classId,
      classId,
      classes,
    );
    const isEnrolled = next.classIds.length > 0;

    batch.update(studentDoc.ref, {
      ...next,
      isEnrolled,
      enrollmentStatus: isEnrolled ? "active" : null,
      updatedAt: serverTimestamp(),
    });
  });

  await commitInChunks(memberSnap.docs, (batch, memberDoc) => {
    batch.delete(memberDoc.ref);
  });
};
