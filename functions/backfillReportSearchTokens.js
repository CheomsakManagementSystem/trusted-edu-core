"use strict";

const admin = require("firebase-admin");
const { buildReportSearchTokens } = require("./reportSearchTokens");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const applyChanges = process.argv.includes("--apply");
const pageSize = 300;

const arraysEqual = (left, right) =>
  Array.isArray(left)
  && left.length === right.length
  && left.every((value, index) => value === right[index]);

const run = async () => {
  let cursor = null;
  let scanned = 0;
  let matched = 0;
  let updated = 0;
  let tokenCount = 0;
  let maxTokens = 0;

  while (true) {
    let reportsQuery = db
      .collection("reports")
      .orderBy(admin.firestore.FieldPath.documentId())
      .select("studentName", "sourceName", "fileName", "essayTopic", "reviewer", "searchTokens")
      .limit(pageSize);
    if (cursor) reportsQuery = reportsQuery.startAfter(cursor);

    const snapshot = await reportsQuery.get();
    if (snapshot.empty) break;

    const changes = snapshot.docs.flatMap((reportDoc) => {
      const data = reportDoc.data();
      const searchTokens = buildReportSearchTokens(data);
      tokenCount += searchTokens.length;
      maxTokens = Math.max(maxTokens, searchTokens.length);
      return arraysEqual(data.searchTokens, searchTokens)
        ? []
        : [{ ref: reportDoc.ref, searchTokens }];
    });

    scanned += snapshot.size;
    matched += changes.length;

    if (applyChanges && changes.length > 0) {
      const batch = db.batch();
      changes.forEach(({ ref, searchTokens }) => batch.update(ref, { searchTokens }));
      await batch.commit();
      updated += changes.length;
    }

    cursor = snapshot.docs[snapshot.docs.length - 1].id;
    if (snapshot.size < pageSize) break;
  }

  console.log(JSON.stringify({
    mode: applyChanges ? "apply" : "dry-run",
    scanned,
    matched,
    updated,
    averageTokens: scanned ? Math.round(tokenCount / scanned) : 0,
    maxTokens,
  }));
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
