export type CanonicalRole = "ADMIN" | "INSTRUCTOR" | "STUDENT";

export const normalizeRole = (role?: string | null): CanonicalRole => {
  const normalized = (role ?? "").toUpperCase();

  if (normalized === "ADMIN") {
    return "ADMIN";
  }

  if (normalized === "INSTRUCTOR" || normalized === "STAFF") {
    return "INSTRUCTOR";
  }

  return "STUDENT";
};

export const isAdminRole = (role?: string | null): boolean => normalizeRole(role) === "ADMIN";

export const isInstructorRole = (role?: string | null): boolean =>
  normalizeRole(role) === "INSTRUCTOR";

export const isStaffRole = (role?: string | null): boolean => {
  const normalized = normalizeRole(role);
  return normalized === "ADMIN" || normalized === "INSTRUCTOR";
};

export const roleLabel = (role?: string | null): string => normalizeRole(role);
