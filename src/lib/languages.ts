/**
 * Native-language filter is a core pillar (PRD §1). Ordered roughly by number of speakers so the common choices are
 * near the top of a dropdown; the North-East tribal languages follow the scheduled ones.
 */
export const SCHEDULED_LANGUAGES = [
  "Hindi", "Bengali", "Marathi", "Telugu", "Tamil", "Gujarati", "Urdu", "Kannada", "Odia", "Malayalam", "Punjabi",
  "Assamese", "Maithili", "Santali", "Kashmiri", "Nepali", "Sindhi", "Konkani", "Dogri", "Manipuri", "Bodo", "Sanskrit",
] as const; // the 22 languages of the Eighth Schedule to the Constitution

export const LANGUAGES = [
  "Hindi", "English", "Bengali", "Marathi", "Telugu", "Tamil", "Gujarati", "Urdu", "Kannada", "Odia", "Malayalam", "Punjabi",
  "Assamese", "Maithili", "Santali", "Kashmiri", "Nepali", "Sindhi", "Konkani", "Dogri", "Manipuri", "Bodo", "Sanskrit",
  "Khasi", "Garo", "Mising", "Karbi",
] as const;

export const DEFAULT_NATIVE_LANGUAGE = "Hindi";
