type StudentPhoneFields = {
  phoneNumber?: string | null;
  phoneSuffix?: string | null;
  studentId?: string | null;
};

const getLast4Digits = (value: string | null | undefined): string => {
  if (!value) {
    return "";
  }
  const digitsOnly = value.replace(/\D/g, "");
  if (digitsOnly.length < 4) {
    return "";
  }
  return digitsOnly.slice(-4);
};

export const getStudentPhoneSuffix = (fields: StudentPhoneFields): string => {
  return (
    getLast4Digits(fields.phoneNumber) ||
    getLast4Digits(fields.phoneSuffix) ||
    getLast4Digits(fields.studentId)
  );
};

export const formatStudentName = (name: string, fields: StudentPhoneFields = {}): string => {
  const normalizedName = name.trim();
  const suffix = getStudentPhoneSuffix(fields);
  if (!normalizedName) {
    return suffix ? `(${suffix})` : "";
  }
  return suffix ? `${normalizedName}(${suffix})` : normalizedName;
};

