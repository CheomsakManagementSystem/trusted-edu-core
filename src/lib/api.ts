const API_URL = "https://script.google.com/macros/s/AKfycbyVybZ62i5wtU32gDMZEk6rLE3RAEimozCY1KIHExNeMMChzIWQTb2oE9zPK_HCO8Ow/exec";

export interface Student {
  id?: string;
  name: string;
  class: string;
  phone?: string;
  parentPhone?: string;
  school?: string;
  grade?: string;
  enrollDate?: string;
  status?: string;
}

export interface Score {
  id?: string;
  studentId: string;
  studentName?: string;
  subject: string;
  score: number;
  date: string;
  feedback?: string;
}

export interface ClassInfo {
  id?: string;
  name: string;
  instructor?: string;
  schedule?: string;
  maxStudents?: number;
  currentStudents?: number;
  status?: string;
}

export interface UploadItem {
  id?: string;
  fileName: string;
  category?: string;
  uploadDate?: string;
  description?: string;
  url?: string;
}

type SheetName = "students" | "scores" | "classes" | "uploads" | "settings";

interface ApiRequest {
  action: "read" | "create" | "update" | "delete";
  sheet: SheetName;
  data?: Record<string, unknown>;
  id?: string;
}

async function apiCall<T>(request: ApiRequest): Promise<T> {
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(request),
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const result = await response.json();
    return result as T;
  } catch (error) {
    console.error("API call failed:", error);
    throw error;
  }
}

async function apiGet<T>(sheet: SheetName): Promise<T> {
  try {
    const url = `${API_URL}?sheet=${sheet}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    return (await response.json()) as T;
  } catch (error) {
    console.error("API GET failed:", error);
    throw error;
  }
}

// Students
export const studentsApi = {
  getAll: () => apiGet<Student[]>("students"),
  create: (data: Student) => apiCall<Student>({ action: "create", sheet: "students", data: data as unknown as Record<string, unknown> }),
  update: (id: string, data: Partial<Student>) => apiCall<Student>({ action: "update", sheet: "students", id, data: data as unknown as Record<string, unknown> }),
  delete: (id: string) => apiCall<void>({ action: "delete", sheet: "students", id }),
};

// Scores
export const scoresApi = {
  getAll: () => apiGet<Score[]>("scores"),
  create: (data: Score) => apiCall<Score>({ action: "create", sheet: "scores", data: data as unknown as Record<string, unknown> }),
  update: (id: string, data: Partial<Score>) => apiCall<Score>({ action: "update", sheet: "scores", id, data: data as unknown as Record<string, unknown> }),
  delete: (id: string) => apiCall<void>({ action: "delete", sheet: "scores", id }),
};

// Classes
export const classesApi = {
  getAll: () => apiGet<ClassInfo[]>("classes"),
  create: (data: ClassInfo) => apiCall<ClassInfo>({ action: "create", sheet: "classes", data: data as unknown as Record<string, unknown> }),
  update: (id: string, data: Partial<ClassInfo>) => apiCall<ClassInfo>({ action: "update", sheet: "classes", id, data: data as unknown as Record<string, unknown> }),
  delete: (id: string) => apiCall<void>({ action: "delete", sheet: "classes", id }),
};

// Uploads
export const uploadsApi = {
  getAll: () => apiGet<UploadItem[]>("uploads"),
  create: (data: UploadItem) => apiCall<UploadItem>({ action: "create", sheet: "uploads", data: data as unknown as Record<string, unknown> }),
  delete: (id: string) => apiCall<void>({ action: "delete", sheet: "uploads", id }),
};
