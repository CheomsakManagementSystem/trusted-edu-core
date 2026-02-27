const functions = require("firebase-functions");
const admin = require("firebase-admin");
const cors = require("cors")({ origin: true });

// Initialize once per runtime instance.
if (!admin.apps.length) {
  admin.initializeApp();
}

const withGlobalCors = (handler) => {
  return async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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
  const fromQuery = req?.query?.uid;

  return String(fromBody || fromCallableStyle || fromQuery || "").trim();
};

const deleteUserHandler = async (req, res) => {
  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).json({ success: false, reason: "Method not allowed" });
    return;
  }

  const uid = extractUid(req);

  if (!uid) {
    res.status(400).json({ success: false, reason: "uid is required" });
    return;
  }

  try {
    await admin.auth().deleteUser(uid);
    res.status(200).json({ success: true, uid, status: "deleted" });
  } catch (error) {
    const code = error && typeof error === "object" ? error.code : "";
    if (code === "auth/user-not-found") {
      // Idempotent delete: already removed is treated as success.
      res.status(200).json({ success: true, uid, status: "already_deleted" });
      return;
    }

    console.error("Delete user failed", { uid, error });
    res.status(500).json({
      success: false,
      reason: error instanceof Error ? error.message : "Failed to delete user",
      code: typeof code === "string" ? code : "unknown_error",
    });
  }
};

exports.adminDeleteUser = functions.https.onRequest(withGlobalCors(deleteUserHandler));
exports.deleteUserByUid = functions.https.onRequest(withGlobalCors(deleteUserHandler));
