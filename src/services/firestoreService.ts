import {
  collection,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Student, Submission, SyncResult } from "@/types";

const USERS_COLLECTION = "users";
const SUBMISSIONS_COLLECTION = "submissions";

export const fetchStudents = async (): Promise<Student[]> => {
  const q = query(
    collection(db, USERS_COLLECTION),
    where("role", "in", ["student", "STUDENT"])
  );
  const snap = await getDocs(q);

  const students: Student[] = [];
  snap.forEach((d) => {
    const data = d.data() as any;
    students.push({
      uid: data.uid ?? d.id,
      name: data.name,
      email: data.email,
      phoneSuffix: data.phoneSuffix,
      studentKey: data.studentKey,
    });
  });

  return students;
};

export const applySyncResults = async (
  results: SyncResult[]
): Promise<{ created: number }> => {
  const matched = results.filter(
    (r) => r.status === "matched" && r.student && r.parsed
  );

  if (!matched.length) return { created: 0 };

  const batch = writeBatch(db);

  matched.forEach((r) => {
    const id = `${r.student!.uid}_${r.file.id}`;
    const ref = doc(db, SUBMISSIONS_COLLECTION, id);
    const data: Submission = {
      id,
      studentUid: r.student!.uid,
      studentName: r.student!.name,
      score: r.parsed!.score,
      driveFileId: r.file.id,
      driveFileName: r.file.name,
      webViewLink: r.file.webViewLink,
      createdTime: r.file.createdTime,
    };
    batch.set(ref, data, { merge: true });
  });

  await batch.commit();

  return { created: matched.length };
};
