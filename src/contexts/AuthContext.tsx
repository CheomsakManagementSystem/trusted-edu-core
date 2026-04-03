import {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  User,
  onAuthStateChanged,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { normalizeRole, type CanonicalRole } from "@/lib/authz";

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
  className?: string | null;
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

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: User | null) => {
      unsubscribeProfile?.();
      unsubscribeProfile = null;

      if (!firebaseUser) {
        setUser(null);
        setLoading(false);
        return;
      }

      try {
        const userRef = doc(db, "users", firebaseUser.uid);
        unsubscribeProfile = onSnapshot(
          userRef,
          (snap) => {
            if (!snap.exists()) {
              setUser({
                uid: firebaseUser.uid,
                name: firebaseUser.displayName ?? "사용자",
                email: firebaseUser.email,
                role: "STUDENT",
              });
              setLoading(false);
              return;
            }

            const data = snap.data() as {
              name: string;
              email: string;
              role?: string;
              studentId?: string;
              studentKey?: string;
              phoneSuffix?: string;
              classId?: string | null;
              className?: string | null;
            };

            const inferredStudentId =
              data.studentId ??
              data.phoneSuffix ??
              data.studentKey?.match(/_(\d{4})$/)?.[1];

            setUser({
              uid: firebaseUser.uid,
              name: data.name,
              email: data.email,
              role: normalizeRole(data.role),
              studentId: inferredStudentId,
              studentKey: data.studentKey,
              phoneSuffix: data.phoneSuffix,
              classId: data.classId ?? null,
              className: data.className ?? null,
            });
            setLoading(false);
          },
          (error) => {
            console.error("Failed to subscribe user profile", error);
            setUser(null);
            setLoading(false);
          },
        );
      } catch (error) {
        console.error("Failed to load user profile", error);
        setUser(null);
        setLoading(false);
      }
    });

    return () => {
      unsubscribeProfile?.();
      unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await firebaseSignOut(auth);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
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
