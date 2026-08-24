"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  createArchivePath,
  createRunResult,
  runReportAutoMatchJob,
  serializeRunResult,
} = require("./reportAutoMatchJob");

const summary = {
  runId: "20260810082609_f0654293",
  version: "class-name-v1",
  pendingCount: 2018,
  matchCandidateCount: 267,
  matchedCount: 267,
  staleCount: 0,
  errorCount: 0,
  unmatched: {
    missingName: 0,
    missingClass: 1,
    ambiguousClass: 0,
    noStudent: 1720,
    ambiguousStudent: 30,
    notEligible: 0,
  },
};

const makeStorage = (save) => ({
  bucket: () => ({ file: (path) => ({ save: (body, options) => save(path, body, options) }) }),
});

const makeAdmin = () => {
  const documents = new Map();
  const makeRef = (path) => ({
    path,
    set: async (value, options) => {
      const previous = options?.merge ? documents.get(path) ?? {} : {};
      documents.set(path, { ...previous, ...value });
    },
  });
  const db = {
    doc: makeRef,
    collection: (name) => ({
      doc: (id) => makeRef(`${name}/${id}`),
      where: () => ({ get: async () => ({ docs: [], size: 0 }) }),
      get: async () => ({ docs: [], size: 0 }),
    }),
    runTransaction: async (worker) => worker({
      get: async (ref) => ({ data: () => documents.get(ref.path) }),
      set: (ref, value, options) => {
        const previous = options?.merge ? documents.get(ref.path) ?? {} : {};
        documents.set(ref.path, { ...previous, ...value });
      },
    }),
  };
  const admin = {
    firestore: Object.assign(() => db, {
      FieldValue: { serverTimestamp: () => ({ serverTimestamp: true }) },
      Timestamp: { fromMillis: (milliseconds) => ({ toMillis: () => milliseconds }) },
    }),
  };
  return { admin, documents };
};

describe("report auto-match JSON archive", () => {
  it("serializes canonical KPI data, dates, and nested unmatched without PII", () => {
    const result = createRunResult({
      summary,
      status: "success",
      startedMs: new Date("2026-08-10T08:26:09.000Z"),
      finishedMs: { toMillis: () => Date.parse("2026-08-10T08:26:13.774Z") },
    });
    const parsed = JSON.parse(serializeRunResult(result));

    assert.equal(parsed.startedAt, "2026-08-10T08:26:09.000Z");
    assert.equal(parsed.finishedAt, "2026-08-10T08:26:13.774Z");
    assert.equal(parsed.durationMs, 4774);
    assert.deepEqual(parsed.unmatched, summary.unmatched);
    assert.equal(parsed.schedule, "daily_02_kst");
    assert.equal(parsed.uid, undefined);
    assert.equal(parsed.phoneNumber, undefined);
    assert.equal(parsed.report, undefined);
  });

  it("uses one deterministic object path for the same runId", () => {
    const expected = "report-auto-match-runs/2026/08/10/20260810082609_f0654293.json";
    assert.equal(createArchivePath(summary.runId), expected);
    assert.equal(createArchivePath(summary.runId), expected);
  });

  it("archives success and additively preserves Firestore KPI fields", async () => {
    const { admin, documents } = makeAdmin();
    const saved = [];
    const times = [Date.parse("2026-08-10T08:26:09Z"), Date.parse("2026-08-10T08:26:13Z")];
    const result = await runReportAutoMatchJob({
      admin,
      now: () => times.shift(),
      storage: makeStorage(async (...args) => saved.push(args)),
      logger: { info() {}, error() {}, warn() {} },
    });
    const runDocument = documents.get(`report_auto_match_runs/${result.runId}`);

    assert.equal(result.status, "success");
    assert.equal(saved.length, 1);
    assert.equal(runDocument.pendingCount, 0);
    assert.equal(runDocument.matchedCount, 0);
    assert.deepEqual(runDocument.unmatched, {
      missingName: 0,
      missingClass: 0,
      ambiguousClass: 0,
      noStudent: 0,
      ambiguousStudent: 0,
      notEligible: 0,
    });
    assert.equal(runDocument.archiveStatus, "success");
    assert.equal(runDocument.archivePath, saved[0][0]);
  });

  it("keeps a successful match result when archive storage fails", async () => {
    const { admin, documents } = makeAdmin();
    const warnings = [];
    const times = [1_000, 2_000];
    const result = await runReportAutoMatchJob({
      admin,
      now: () => times.shift(),
      storage: makeStorage(async () => {
        throw Object.assign(new Error("denied"), { code: "storage/unauthorized" });
      }),
      logger: { info() {}, error() {}, warn: (...args) => warnings.push(args) },
    });
    const runDocument = documents.get(`report_auto_match_runs/${result.runId}`);

    assert.equal(result.status, "success");
    assert.equal(result.archiveStatus, "failed");
    assert.equal(runDocument.status, "success");
    assert.equal(runDocument.archiveStatus, "failed");
    assert.equal(runDocument.archiveErrorCode, "storage/unauthorized");
    assert.equal(warnings[0][0], "report_auto_match_archive_failed");
  });
});
