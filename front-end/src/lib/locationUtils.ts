/** Returns true if this looks like a real geographic location */
export function isValidLocation(loc: string): boolean {
  if (!loc || loc.length < 2) return false;
  // Exclude salary-like strings
  if (/KSh|USD|\$|KES/i.test(loc)) return false;
  // Exclude strings with comma-separated large numbers (salary patterns)
  if (/\d{2,},\d{3}/.test(loc)) return false;
  // Exclude "Confidential"
  if (/^confidential$/i.test(loc.trim())) return false;
  // Exclude concatenated garbage (contains job type keywords mashed in)
  if (/full.?time|part.?time|contract|internship|education/i.test(loc)) return false;
  // Exclude strings that are just numbers
  if (/^\d+[\s\-,\d]*$/.test(loc)) return false;
  // Must have letters
  if (!/[a-zA-Z]/.test(loc)) return false;
  return true;
}
