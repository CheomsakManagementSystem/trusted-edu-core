const functions = require("firebase-functions");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const cors = require("cors")({ origin: true });
const crypto = require("crypto");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const ADMIN_ROLE = "ADMIN";
const MASTER_ADMIN_CODE = defineSecret("MASTER_ADMIN_CODE");
const INSTRUCTOR_SIGNUP_CODE = defineSecret("INSTRUCTOR_SIGNUP_CODE");
const signupSettingsRef = db.collection("server_settings").doc("signup");
const masterControlsRef = db.collection("systemSettings").doc("masterControls");

const secureEquals = (input, expected) => {
  const left = Buffer.from(String(input || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
};

const digestInstructorCode = (value) =>
  crypto
    .createHmac("sha256", MASTER_ADMIN_CODE.value())
    .update(String(value || ""))
    .digest("hex");

const matchesInstructorCode = async (input) => {
  if (!input) {
    return false;
  }

  const settingsSnap = await signupSettingsRef.get();
  const storedDigest = String(settingsSnap.data()?.instructorCodeDigest || "");
  if (storedDigest) {
    return secureEquals(digestInstructorCode(input), storedDigest);
  }

  return secureEquals(input, INSTRUCTOR_SIGNUP_CODE.value());
};

const resolveSignupRole = async ({ masterCode, instructorCode }) => {
  if (secureEquals(masterCode, MASTER_ADMIN_CODE.value())) {
    return ADMIN_ROLE;
  }
  if (await matchesInstructorCode(instructorCode)) {
    return "INSTRUCTOR";
  }
  return "STUDENT";
};

const assertStudentIdAvailable = async (uid, phoneSuffix) => {
  const usersRef = db.collection("users");
  const [suffixSnap, studentIdSnap] = await Promise.all([
    usersRef.where("phoneSuffix", "==", phoneSuffix).limit(5).get(),
    usersRef.where("studentId", "==", phoneSuffix).limit(5).get(),
  ]);

  const conflicts = new Map();
  [...suffixSnap.docs, ...studentIdSnap.docs].forEach((docSnap) => {
    const existingUid = String(docSnap.data()?.uid || docSnap.id);
    if (existingUid !== uid) {
      conflicts.set(docSnap.id, docSnap);
    }
  });

  if (conflicts.size > 0) {
    throw new HttpsError("already-exists", "이미 사용 중인 4자리 ID입니다.");
  }
};

exports.completeSignupProfile = onCall(
  { secrets: [MASTER_ADMIN_CODE, INSTRUCTOR_SIGNUP_CODE] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const name = String(request.data?.name || "").trim();
    const phoneSuffix = String(request.data?.phoneSuffix || "").trim();
    const instructorCode = String(request.data?.instructorCode || "").trim();
    const masterCode = String(request.data?.masterCode || "").trim();
    const email = String(request.auth?.token?.email || request.data?.email || "").trim();

    if (!name) {
      throw new HttpsError("invalid-argument", "이름을 확인해주세요.");
    }
    if (!/^\d{4}$/.test(phoneSuffix)) {
      throw new HttpsError("invalid-argument", "학생 ID는 숫자 4자리여야 합니다.");
    }

    await assertStudentIdAvailable(uid, phoneSuffix);
    const role = await resolveSignupRole({ masterCode, instructorCode });

    const reservationRef = db.collection("student_id_reservations").doc(phoneSuffix);
    const userRef = db.collection("users").doc(uid);

    const savedRole = await db.runTransaction(async (transaction) => {
      const reservationSnap = await transaction.get(reservationRef);
      const userSnap = await transaction.get(userRef);

      const reservedUid = String(reservationSnap.data()?.uid || "");
      if (reservationSnap.exists && reservedUid && reservedUid !== uid) {
        throw new HttpsError("already-exists", "이미 사용 중인 4자리 ID입니다.");
      }

      const existingData = userSnap.data() || {};
      const existingRole = String(existingData.role || "").toUpperCase();
      const effectiveRole = ["ADMIN", "INSTRUCTOR", "STUDENT"].includes(existingRole)
        ? existingRole
        : role;

      transaction.set(
        reservationRef,
        {
          uid,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      transaction.set(
        userRef,
        {
          uid,
          name,
          email: email || existingData.email || null,
          role: effectiveRole,
          studentId: phoneSuffix,
          studentKey: `${name}_${phoneSuffix}`,
          phoneSuffix,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      return effectiveRole;
    });

    return { role: savedRole };
  },
);

const withGlobalCors = (handler) => {
  return async (req, res) => {
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    await new Promise((resolve) => {
      cors(req, res, resolve);
    });

    try {
      await handler(req, res);
    } catch (error) {
      console.error("Function execution failed", error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          reason: error instanceof Error ? error.message : "Internal server error",
        });
      }
    }
  };
};

const extractUid = (req) => {
  const fromBody = req?.body?.uid;
  const fromCallableStyle = req?.body?.data?.uid;
  return String(fromBody || fromCallableStyle || "").trim();
};

const extractAction = (req) => {
  const fromBody = req?.body?.action;
  const fromCallableStyle = req?.body?.data?.action;
  const action = String(fromBody || fromCallableStyle || "delete").trim();
  return action === "disable" ? "disable" : "delete";
};

const getBearerToken = (req) => {
  const authorization = String(req.get("authorization") || "").trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
};

const resolveActorProfile = async (uid) => {
  const usersRef = db.collection("users");
  const [directSnap, querySnap] = await Promise.all([
    usersRef.doc(uid).get(),
    usersRef.where("uid", "==", uid).limit(2).get(),
  ]);

  const candidates = new Map();
  if (directSnap.exists) {
    candidates.set(directSnap.id, directSnap);
  }
  querySnap.docs.forEach((docSnap) => candidates.set(docSnap.id, docSnap));

  if (candidates.size !== 1) {
    return null;
  }

  return Array.from(candidates.values())[0];
};

const requireAdminCallable = async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }

  const profile = await resolveActorProfile(uid);
  const role = String(profile?.data()?.role || "").toUpperCase();
  if (role !== ADMIN_ROLE) {
    throw new HttpsError("permission-denied", "관리자 권한이 필요합니다.");
  }

  return uid;
};

exports.updateMasterControls = onCall(
  { secrets: [MASTER_ADMIN_CODE] },
  async (request) => {
    const actorUid = await requireAdminCallable(request);
    const instructorSignupCode = String(request.data?.instructorSignupCode || "").trim();
    const autoNotifyOnFeedbackComplete = request.data?.autoNotifyOnFeedbackComplete;

    if (typeof autoNotifyOnFeedbackComplete !== "boolean") {
      throw new HttpsError("invalid-argument", "자동 알림 설정값을 확인해주세요.");
    }
    if (instructorSignupCode.length > 256) {
      throw new HttpsError("invalid-argument", "선생님 가입 코드가 너무 깁니다.");
    }

    const batch = db.batch();
    const now = admin.firestore.FieldValue.serverTimestamp();

    batch.set(
      masterControlsRef,
      {
        autoNotifyOnFeedbackComplete,
        instructorSignupCode: admin.firestore.FieldValue.delete(),
        updatedAt: now,
        updatedBy: actorUid,
      },
      { merge: true },
    );

    if (instructorSignupCode) {
      batch.set(
        signupSettingsRef,
        {
          instructorCodeDigest: digestInstructorCode(instructorSignupCode),
          updatedAt: now,
          updatedBy: actorUid,
        },
        { merge: true },
      );
    }

    await batch.commit();
    return { success: true, instructorCodeChanged: Boolean(instructorSignupCode) };
  },
);

const requireAdminActor = async (req) => {
  const token = getBearerToken(req);
  if (!token) {
    return { ok: false, status: 401, reason: "Authentication required" };
  }

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(token, true);
  } catch {
    return { ok: false, status: 401, reason: "Invalid authentication token" };
  }

  const profile = await resolveActorProfile(decoded.uid);
  const profileRole = String(profile?.data()?.role || "").toUpperCase();
  if (profileRole !== ADMIN_ROLE) {
    return { ok: false, status: 403, reason: "Administrator permission required" };
  }

  return { ok: true, uid: decoded.uid };
};

const writeAuditLog = async ({ actorUid, targetUid, action, status }) => {
  try {
    await db.collection("admin_audit_events").add({
      type: "auth_user_mutation",
      actorUid,
      targetUid,
      action,
      status,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error("Failed to write admin audit log", { actorUid, targetUid, action, error });
  }
};

const deleteUserHandler = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ success: false, reason: "Method not allowed" });
    return;
  }

  const actor = await requireAdminActor(req);
  if (!actor.ok) {
    res.status(actor.status).json({ success: false, reason: actor.reason });
    return;
  }

  const uid = extractUid(req);
  const action = extractAction(req);

  if (!uid) {
    res.status(400).json({ success: false, reason: "uid is required" });
    return;
  }

  if (uid === actor.uid) {
    res.status(409).json({ success: false, reason: "Current administrator cannot delete itself" });
    return;
  }

  try {
    if (action === "disable") {
      await admin.auth().updateUser(uid, { disabled: true });
      await writeAuditLog({ actorUid: actor.uid, targetUid: uid, action, status: "disabled" });
      res.status(200).json({ success: true, uid, status: "disabled" });
      return;
    }

    await admin.auth().deleteUser(uid);
    await writeAuditLog({ actorUid: actor.uid, targetUid: uid, action, status: "deleted" });
    res.status(200).json({ success: true, uid, status: "deleted" });
  } catch (error) {
    const code = error && typeof error === "object" ? error.code : "";
    if (code === "auth/user-not-found") {
      await writeAuditLog({ actorUid: actor.uid, targetUid: uid, action, status: "already_deleted" });
      res.status(200).json({ success: true, uid, status: "already_deleted" });
      return;
    }

    console.error("Delete user failed", { actorUid: actor.uid, uid, action, error });
    res.status(500).json({
      success: false,
      reason: error instanceof Error ? error.message : "Failed to delete user",
      code: typeof code === "string" ? code : "unknown_error",
    });
  }
};

exports.adminDeleteUser = functions.https.onRequest(withGlobalCors(deleteUserHandler));
exports.deleteUserByUid = functions.https.onRequest(withGlobalCors(deleteUserHandler));
