import { readFileSync } from "node:fs";

const INDEX_FILE = new URL("../firestore.indexes.json", import.meta.url);
const rawConfig = readFileSync(INDEX_FILE, "utf8");

if (/^(<<<<<<<|=======|>>>>>>>)/m.test(rawConfig)) {
  throw new Error("firestore.indexes.json contains unresolved merge markers");
}

const config = JSON.parse(rawConfig);
if (!Array.isArray(config.indexes)) {
  throw new Error("firestore.indexes.json must contain an indexes array");
}

const fieldSignature = (field) =>
  `${field.fieldPath}:${field.arrayConfig ?? field.order ?? "INVALID"}`;
const indexSignature = (index) => [
  index.collectionGroup,
  index.queryScope,
  ...(Array.isArray(index.fields) ? index.fields.map(fieldSignature) : ["INVALID_FIELDS"]),
].join("|");

const signatures = config.indexes.map(indexSignature);
const duplicateSignatures = signatures.filter(
  (signature, index) => signatures.indexOf(signature) !== index,
);
if (duplicateSignatures.length > 0) {
  throw new Error(`Duplicate Firestore indexes: ${[...new Set(duplicateSignatures)].join(", ")}`);
}

const requiredSearchIndexes = [
  ["searchTokens:CONTAINS", "assignmentStatus:ASCENDING", "createdAt:DESCENDING"],
  [
    "searchTokens:CONTAINS",
    "assignmentStatus:ASCENDING",
    "classId:ASCENDING",
    "createdAt:DESCENDING",
  ],
  [
    "searchTokens:CONTAINS",
    "assignmentStatus:ASCENDING",
    "isRead:ASCENDING",
    "createdAt:DESCENDING",
  ],
  [
    "searchTokens:CONTAINS",
    "assignmentStatus:ASCENDING",
    "classId:ASCENDING",
    "isRead:ASCENDING",
    "createdAt:DESCENDING",
  ],
].map((fields) => ["reports", "COLLECTION", ...fields].join("|"));

const missingSearchIndexes = requiredSearchIndexes.filter(
  (signature) => !signatures.includes(signature),
);
if (missingSearchIndexes.length > 0) {
  throw new Error(`Missing report search indexes: ${missingSearchIndexes.join(", ")}`);
}

console.log(
  `Validated ${config.indexes.length} Firestore indexes, including all report search indexes.`,
);
