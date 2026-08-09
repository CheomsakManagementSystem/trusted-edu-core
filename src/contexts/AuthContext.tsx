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
  doc,
  onSnapshot,
  type DocumentData,
  type DocumentSnapshot,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { normalizeRole, type CanonicalRole } from "@/lib/authz";
import { normalizeClassIds } from "@/services/classTransferService";
import {
  invalidateUserProfileResolution,
  resolveUserProfileSnapshot,
} from "@/services/userProfileResolver";

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
  const unsubscribeProfileRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    const applyProfile = (
      firebaseUser: User,
      snap: DocumentSnapshot<DocumentData>,
    ) => {
      if (!snap.exists() || cancelled) return false;

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

      const inferredStudentId =
        data.studentId ??
        data.phoneSuffix ??
        data.studentKey?.match(/_(\d{4})$/)?.[1];

      setUser({
        uid: firebaseUser.uid,
        name: data.name ?? firebaseUser.displayName ?? "사용자",
        email: data.email ?? firebaseUser.email,
        role: normalizeRole(data.role),
        studentId: inferredStudentId,
        studentKey: data.studentKey,
        phoneSuffix: data.phoneSuffix,
        classId: data.classId ?? null,
        classIds: normalizeClassIds(data.classIds, data.classId),
        className: data.className ?? null,
        docPath: `users/${snap.ref.id}`,
        needsMigration: data.needsMigration === true,
      });
      setLoading(false);
      return true;
    };

    const subscribeToProfile = async (firebaseUser: User, recoveryAttempt = 0) => {
      let resolved = null;
      try {
        resolved = await resolveUserProfileSnapshot(firebaseUser.uid);
      } catch (error) {
        console.error("Failed to resolve user profile", error);
      }

      if (cancelled) return;

      unsubscribeProfileRef.current?.();
      unsubscribeProfileRef.current = null;

      if (!resolved) {
        // createUserWithEmailAndPassword fires before Signup writes users/{uid}.
        // Keep one direct listener so that the just-created profile is picked up
        // without recursively repeating Firestore reads.
        const uidRef = doc(db, "users", firebaseUser.uid);
        unsubscribeProfileRef.current = onSnapshot(
          uidRef,
          (snap) => {
            if (snap.exists()) {
              invalidateUserProfileResolution(firebaseUser.uid);
              applyProfile(firebaseUser, snap);
            } else {
              setUser(null);
              setLoading(false);
            }
          },
          (error) => {
            console.error("Failed to subscribe user profile", error);
            setUser(null);
            setLoading(false);
          },
        );
        return;
      }

      // The resolver snapshot is already available. Use it immediately instead of
      // waiting for onSnapshot to deliver the same initial document again.
      applyProfile(firebaseUser, resolved.snapshot);

      unsubscribeProfileRef.current = onSnapshot(
        resolved.ref,
        (snap) => {
          if (snap.exists()) {
            applyProfile(firebaseUser, snap);
            return;
          }

          if (recoveryAttempt < 1 && !cancelled) {
            invalidateUserProfileResolution(firebaseUser.uid);
            unsubscribeProfileRef.current?.();
            unsubscribeProfileRef.current = null;
            setLoading(true);
            void subscribeToProfile(firebaseUser, recoveryAttempt + 1);
            return;
          }

          setUser(null);
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
      unsubscribeProfileRef.current?.();
      unsubscribeProfileRef.current = null;

      if (!firebaseUser) {
        setUser(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      void subscribeToProfile(firebaseUser);
    });

    return () => {
      cancelled = true;
      unsubscribeProfileRef.current?.();
      unsubscribeProfileRef.current = null;
      unsubscribeAuth();
    };
  }, []);

  const signOut = useCallback(async () => {
    if (auth.currentUser?.uid) {
      invalidateUserProfileResolution(auth.currentUser.uid);
    }
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
