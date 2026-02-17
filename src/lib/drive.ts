// 구글 드라이브 URL에서 파일 ID를 추출하고 preview URL을 만들어주는 유틸리티
// 예시 입력:
// - https://drive.google.com/file/d/FILE_ID/view?usp=sharing
// - https://drive.google.com/open?id=FILE_ID
// - https://drive.google.com/uc?id=FILE_ID&export=download

export const extractDriveFileId = (url: string): string | null => {
  try {
    const u = new URL(url);

    // /file/d/:id/...
    const fileMatch = u.pathname.match(/\/file\/d\/([^/]+)/);
    if (fileMatch?.[1]) return fileMatch[1];

    // ?id=...
    const idParam = u.searchParams.get("id");
    if (idParam) return idParam;

    // /uc?id=...
    if (u.pathname.includes("/uc")) {
      const ucId = u.searchParams.get("id");
      if (ucId) return ucId;
    }
  } catch {
    return null;
  }

  return null;
};

export const toDrivePreviewUrl = (url: string): string | null => {
  const id = extractDriveFileId(url);
  if (!id) return null;
  return `https://drive.google.com/file/d/${id}/preview`;
};

