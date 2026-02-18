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
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

type Role = "staff" | "student";

interface AppUser {
  uid: string;
  name: string;
  email: string | null;
  role: Role;
  studentId?: string;
  studentKey?: string;
  phoneSuffix?: string;
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
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: User | null) => {
      if (!firebaseUser) {
        setUser(null);
        setLoading(false);
        return;
      }

      try {
        const userRef = doc(db, "users", firebaseUser.uid);
        const snap = await getDoc(userRef);

        if (!snap.exists()) {
          // Firestore에 문서가 없는 경우, 최소 정보만 구성
          setUser({
            uid: firebaseUser.uid,
            name: firebaseUser.displayName ?? "사용자",
            email: firebaseUser.email,
            role: "student",
          });
        } else {
          const data = snap.data() as {
            name: string;
            email: string;
            role: Role;
            studentId?: string;
            studentKey?: string;
            phoneSuffix?: string;
          };

          const inferredStudentId =
            data.studentId ??
            data.phoneSuffix ??
            data.studentKey?.match(/_(\d{4})$/)?.[1];

          setUser({
            uid: firebaseUser.uid,
            name: data.name,
            email: data.email,
            role: data.role,
            studentId: inferredStudentId,
            studentKey: data.studentKey,
            phoneSuffix: data.phoneSuffix,
          });
        }
      } catch (error) {
        console.error("Failed to load user profile", error);
        setUser(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
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
