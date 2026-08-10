export const normalizePhoneNumber = (value: string): string => value.replace(/\D/g, "");

export const isSupportedPhoneNumber = (value: string): boolean => {
  const normalized = normalizePhoneNumber(value);
  return /^0\d{9,10}$/.test(normalized);
};

export const getPhoneLast4 = (value: string): string => {
  const normalized = normalizePhoneNumber(value);
  return normalized.length >= 4 ? normalized.slice(-4) : "";
};
