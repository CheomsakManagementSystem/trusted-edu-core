const functions = require("firebase-functions");
const admin = require("firebase-admin");
const cors = require("cors")({ origin: true });

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const ADMIN_ROLE = "ADMIN";

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
