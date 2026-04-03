import {
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
