import { DriveFile } from "@/types";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3/files";

const API_KEY = import.meta.env.VITE_GOOGLE_DRIVE_API_KEY;

if (!API_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    "[driveApi] VITE_GOOGLE_DRIVE_API_KEY is not set. Drive sync will not work."
  );
}

interface ListFilesParams {
  folderId: string;
  pageSize?: number;
}

interface DriveListResponse {
  files: {
    id: string;
    name: string;
    webViewLink: string;
    createdTime: string;
  }[];
}

const buildListUrl = ({ folderId, pageSize = 1000 }: ListFilesParams) => {
  const params = new URLSearchParams();
  params.set("key", API_KEY ?? "");
  params.set("pageSize", String(pageSize));
  params.set("fields", "files(id,name,webViewLink,createdTime)");
  params.set("q", `'${folderId}' in parents and trashed = false`);
  params.set("includeItemsFromAllDrives", "true");
  params.set("supportsAllDrives", "true");

  return `${DRIVE_API_BASE}?${params.toString()}`;
};

export const listDriveFiles = async (
  params: ListFilesParams
): Promise<DriveFile[]> => {
  if (!API_KEY) {
    throw new Error("Google Drive API key is not configured.");
  }

  const url = buildListUrl(params);

  let attempt = 0;
  const maxAttempts = 2;

  // 간단한 재시도 전략 (네트워크 오류 대응)
  // 백오프는 짧게(500ms)만 주어 관리자가 빠르게 재시도할 수 있게 함.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(url, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          `Drive API error: ${res.status} ${res.statusText} - ${text}`
        );
      }

      const data = (await res.json()) as DriveListResponse;

      return data.files.map((f) => ({
        id: f.id,
        name: f.name,
        webViewLink: f.webViewLink,
        createdTime: f.createdTime,
      }));
    } catch (err) {
      attempt += 1;
      if (attempt >= maxAttempts) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
};

