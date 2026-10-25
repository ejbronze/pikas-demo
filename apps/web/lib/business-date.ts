// The PIKAS business calendar date: America/Santo_Domingo, never the UTC date (after 20:00 AST, UTC is already
// tomorrow) and never the browser's own zone. Use it for any default or label that means "today" in a school.
export const BUSINESS_TIMEZONE = "America/Santo_Domingo";
export const businessDate = (date = new Date()) => date.toLocaleDateString("en-CA", { timeZone: BUSINESS_TIMEZONE });
