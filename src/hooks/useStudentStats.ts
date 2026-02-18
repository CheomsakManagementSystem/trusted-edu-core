import { useEffect, useState } from "react";
import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Submission } from "@/types";

interface UseStudentStatsOptions {
  studentUid?: string;
}

export const useStudentStats = ({ studentUid }: UseStudentStatsOptions) => {
  const [submissions, setSubmissions] = useState<Submission[]>([]);

  useEffect(() => {
    if (!studentUid) {
      setSubmissions([]);
      return;
    }

    const q = query(
      collection(db, "submissions"),
      where("studentUid", "==", studentUid),
      orderBy("createdTime", "asc")
    );

    const unsub = onSnapshot(q, (snap) => {
      const list: Submission[] = [];
      snap.forEach((d) => {
        const data = d.data() as Submission;
        list.push(data);
      });
      setSubmissions(list);
    });

    return () => unsub();
  }, [studentUid]);

  const chartData = submissions.map((s) => ({
    date: new Date(s.createdTime).toLocaleDateString("ko-KR", {
      month: "short",
      day: "numeric",
    }),
    score: s.score,
  }));

  return {
    submissions,
    chartData,
  };
};

