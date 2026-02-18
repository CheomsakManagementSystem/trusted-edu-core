export type SyncStatus = "matched" | "no_student" | "parse_error";

export interface DriveFile {
  id: string;
  name: string;
  webViewLink: string;
  createdTime: string;
}

export interface ParsedSubmission {
  studentName: string;
  phoneSuffix: string;
  score: number;
}

export interface Student {
  uid: string;
  name: string;
  email: string;
  phoneSuffix?: string;
  studentKey?: string;
}

export interface SyncResult {
  file: DriveFile;
  parsed?: ParsedSubmission;
  student?: Student;
  status: SyncStatus;
  reason?: string;
}

export interface Submission {
  id: string;
  studentUid: string;
  studentName: string;
  score: number;
  driveFileId: string;
  driveFileName: string;
  webViewLink: string;
  createdTime: string;
}

