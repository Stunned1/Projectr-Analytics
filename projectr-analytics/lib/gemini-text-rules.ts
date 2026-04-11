/**
 * Shared copy rule for Gemini system/user prompts so model output matches app typography
 * (the codebase does not use Unicode em dash U+2014).
 */
export const GEMINI_NO_EM_DASH_RULE =
  'Typography: Do not use em dashes (Unicode U+2014, the long dash). Use a regular hyphen (-), commas, colons, or parentheses instead.'
