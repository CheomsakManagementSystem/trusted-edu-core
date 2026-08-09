import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

const PROFILE_CACHE_TTL_MS = 5_000;

export type ResolvedUserProfile = {
  ref: DocumentReference<DocumentData>;
  snapshot: DocumentSnapshot<DocumentData>;
};

type CacheEntry = {
  value: ResolvedUserProfile | null;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<ResolvedUserProfile | null>>();

const resolveFresh = async (uid: string): Promise<ResolvedUserProfile | null> => {
  const directRef = doc(db, "users", uid);
  const directSnap = await getDoc(directRef);
  if (directSnap.exists()) {
    return { ref: directRef, snapshot: directSnap };
  }

  const uidSnap = await getDocs(
    query(collection(db, "users"), where("uid", "==", uid), limit(2)),
  );

  if (uidSnap.size > 1) {
    throw new Error("동일한 인증 UID의 사용자 프로필이 여러 개 존재합니다.");
  }
  if (uidSnap.empty) {
    return null;
  }

  const snapshot = uidSnap.docs[0];
  return { ref: snapshot.ref, snapshot };
};

export const invalidateUserProfileResolution = (uid: string) => {
  cache.delete(uid.trim());
};

export const resolveUserProfileSnapshot = async (
  uid: string,
): Promise<ResolvedUserProfile | null> => {
  const normalizedUid = uid.trim();
  if (!normalizedUid) return null;

  const cached = cache.get(normalizedUid);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  cache.delete(normalizedUid);

  const pending = inFlight.get(normalizedUid);
  if (pending) return pending;

  const request = resolveFresh(normalizedUid)
    .then((value) => {
      cache.set(normalizedUid, {
        value,
        expiresAt: Date.now() + PROFILE_CACHE_TTL_MS,
      });
      return value;
    })
    .finally(() => {
      inFlight.delete(normalizedUid);
    });

  inFlight.set(normalizedUid, request);
  return request;
};
