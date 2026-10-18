// Existing POS recovery journals are evidence, never Demo navigation state.
// Outside the mounted POS controller, even a saved confirmed receipt must be
// reconciled there before Demo controls can discard its tracking information.
export function hasDemoFinancialJournal(storage?: Pick<Storage, "getItem">): boolean {
  try {
    const journalStorage = storage ?? window.sessionStorage;
    return Boolean(journalStorage.getItem("pikas:connected-pos:pending:v1") || journalStorage.getItem("pikas:connected-pos:register:v1"));
  } catch { return true; }
}
