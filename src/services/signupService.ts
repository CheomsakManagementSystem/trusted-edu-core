import { doc, getDoc } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "@/lib/firebase";
import type { CanonicalRole } from "@/lib/authz";

type SignupPayload = {
  name: string;
  email: string;
  phoneSuffix: string;
  instructorCode: string;
  masterCode: string;
};

type SignupResult = {
  role?: CanonicalRole;
};

const functions = getFunctions();
const completeProfile = httpsCallable<SignupPayload, SignupResult>(
  functions,
  "completeSignupProfile",
);

const isCanonicalRole = (value: unknown): value is CanonicalRole =>
  value === "ADMIN" || value === "INSTRUCTOR" || value === "STUDENT";

const getErrorCode = (error: unknown): string =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";

const isRetryable = (error: unknown): boolean =>
  [
    "functions/internal",
    "functions/unavailable",
    "functions/deadline-exceeded",
    "functions/unknown",
  ].includes(getErrorCode(error));

const invokeCompleteProfile = async (payload: SignupPayload): Promise<CanonicalRole> => {
  const result = await completeProfile(payload);
  if (!isCanonicalRole(result.data?.role)) {
    throw new Error("회원가입 권한 응답을 확인할 수 없습니다.");
  }
  return result.data.role;
};

export const completeSignupProfile = async (payload: SignupPayload): Promise<CanonicalRole> => {
  try {
    return await invokeCompleteProfile(payload);
  } catch (error) {
    if (!isRetryable(error)) {
      throw error;
    }
    return invokeCompleteProfile(payload);
  }
};

export const fetchCompletedSignupRole = async (uid: string): Promise<CanonicalRole | null> => {
  const snapshot = await getDoc(doc(db, "users", uid));
  if (!snapshot.exists()) {
    return null;
  }

  const role = snapshot.data()?.role;
  return isCanonicalRole(role) ? role : null;
};

export const getSignupServiceErrorCode = getErrorCode;
