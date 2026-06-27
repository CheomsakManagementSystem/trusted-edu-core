import {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  useState,
} from "react";
import {
  User,
  onAuthStateChanged,
  signOut as firebaseSignOut,
} from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { normalizeRole, type CanonicalRole } from "@/lib/authz";
import { normalizeClassIds } from "@/services/classTransferService";

type Role = CanonicalRole;

interface AppUser {
  uid: string;
  name: string;
  email: string | null;
  role: Role;
  studentId?: string;
  studentKey?: string;
  phoneSuffix?: string;
  classId?: string | null;
  classIds: string[];
  className?: string | null;
  /** Firestore 문서 경로 (users/{docId}) */
  docPath: string;
  /**
   * true = doc이 users/{uid}에 있는 레거시 학생 → 마이그레이션 필요.
   * 마이그레이션 완료 후 doc이 users/{customId}로 이동하면 false가 됨.
   */
  needsMigration: boolean;
}

interface AuthContextValue {
  user: AppUser | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  // ref로 unsubscribe 관리 → re-subscribe 시 클로저 문제 방지
  const unsubscribeProfileRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    const subscribeToProfile = async (firebaseUser: User) => {
      // ① 레거시 직접 조회 (users/{uid})
      const uidRef = doc(db, "users", firebaseUser.uid);

      // ② uid 필드 기반 쿼리 (신형 users/{customId} 문서)
      const resolveRef = async () => {
        try {
          const q = query(
            collection(db, "users"),
            where("uid", "==", firebaseUser.uid),
            limit(1),
          );
          const qs = await getDocs(q);
          return qs.empty ? null : qs.docs[0].ref;
        } catch {
          return null;
        }
      };

      // 어떤 ref를 구독할지 결정
      let targetRef = uidRef;
      try {
        const { getDoc } = await import("firebase/firestore");
        const directSnap = await getDoc(uidRef);
        if (!directSnap.exists()) {
          const found = await resolveRef();
          if (found) targetRef = found;
        }
      } catch {
        /* 네트워크 오류 시 uid ref로 폴백 */
      }

      if (cancelled) return;

      unsubscribeProfileRef.current?.();
      unsubscribeProfileRef.current = onSnapshot(
        targetRef,
        async (snap) => {
          if (!snap.exists()) {
            // 마이그레이션 배치로 문서가 삭제된 경우 → 새 문서로 재구독
            if (!cancelled) {
              unsubscribeProfileRef.current?.();
              unsubscribeProfileRef.current = null;
              await subscribeToProfile(firebaseUser);
            }
            return;
          }

          const data = snap.data() as {
            name?: string;
            email?: string;
            role?: string;
            studentId?: string;
            studentKey?: string;
            phoneSuffix?: string;
            classId?: string | null;
            classIds?: unknown;
            className?: string | null;
            needsMigration?: boolean;
          };

          console.log("Loaded user data:", data);
          console.log("Loaded classIds:", data.classIds);

          const inferredStudentId =
            data.studentId ??
            data.phoneSuffix ??
            data.studentKey?.match(/_(\d{4})$/)?.[1];

          const role = normalizeRole(data.role);
          const needsMigration = data.needsMigration === true;

          const newClassIds = normalizeClassIds(data.classIds, data.classId);

          setUser((prev) => ({
            ...prev,
            uid: firebaseUser.uid,
            name: data.name ?? firebaseUser.displayName ?? "사용자",
            email: data.email ?? firebaseUser.email,
            role,
            studentId: inferredStudentId,
            studentKey: data.studentKey,
            phoneSuffix: data.phoneSuffix,
            classId: data.classId ?? null,
            classIds: newClassIds,
            className: data.className ?? null,
            docPath: `users/${snap.ref.id}`,
            needsMigration,
          }));
          setLoading(false);
        },
        (error) => {
          console.error("Failed to subscribe user profile", error);
          setUser(null);
          setLoading(false);
        },
      );
    };

    const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser: User | null) => {
      cancelled = false;
      unsubscribeProfileRef.current?.();
      unsubscribeProfileRef.current = null;

      if (!firebaseUser) {
        setUser(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      subscribeToProfile(firebaseUser);
    });

    return () => {
      cancelled = true;
      unsubscribeProfileRef.current?.();
      unsubscribeProfileRef.current = null;
      unsubscribeAuth();
    };
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, signOut }),
    [user, loading, signOut],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
};
