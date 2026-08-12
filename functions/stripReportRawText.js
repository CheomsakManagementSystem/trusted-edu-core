const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const applyChanges = process.argv.includes("--apply");
const pageSize = 300;

const run = async () => {
  let cursor = null;
  let scanned = 0;
  let matched = 0;

  while (true) {
    let reportsQuery = db
      .collection("reports")
      .orderBy(admin.firestore.FieldPath.documentId())
      .select("parsedJson.rawText")
      .limit(pageSize);
    if (cursor) reportsQuery = reportsQuery.startAfter(cursor);

    const snapshot = await reportsQuery.get();
    if (snapshot.empty) break;

    const targets = snapshot.docs.filter((reportDoc) =>
      typeof reportDoc.get("parsedJson.rawText") === "string",
    );
    scanned += snapshot.size;
    matched += targets.length;

    if (applyChanges && targets.length > 0) {
      const batch = db.batch();
      targets.forEach((reportDoc) => {
        batch.update(reportDoc.ref, {
          "parsedJson.rawText": admin.firestore.FieldValue.delete(),
        });
      });
      await batch.commit();
    }

    cursor = snapshot.docs[snapshot.docs.length - 1].id;
    if (snapshot.size < pageSize) break;
  }

  console.log(JSON.stringify({ mode: applyChanges ? "apply" : "dry-run", scanned, matched }));
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
