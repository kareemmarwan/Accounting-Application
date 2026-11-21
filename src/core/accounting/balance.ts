import { getGLAccount } from "./chart-of-accounts";
import type { Minor } from "./money";
import type { JournalEntry } from "./types";

export interface BalanceState {
  glBalances: Record<string, Minor>;
  accountBalances: Record<string, Minor>;
  customerBalances: Record<string, Minor>;
  supplierBalances: Record<string, Minor>;
}

export function emptyBalanceState(): BalanceState {
  return {
    glBalances: {},
    accountBalances: {},
    customerBalances: {},
    supplierBalances: {}
  };
}

function addSigned(
  record: Record<string, Minor>,
  key: string,
  delta: Minor
): void {
  record[key] = (record[key] ?? 0) + delta;
}

export function applyEntry(state: BalanceState, entry: JournalEntry): BalanceState {
  const next: BalanceState = {
    glBalances: { ...state.glBalances },
    accountBalances: { ...state.accountBalances },
    customerBalances: { ...state.customerBalances },
    supplierBalances: { ...state.supplierBalances }
  };

  for (const line of entry.lines) {
    const delta: Minor = line.debit - line.credit;
    const gl = getGLAccount(line.glCode);
    const factor = gl.type === "asset" || gl.type === "expense" ? 1 : -1;
    addSigned(next.glBalances, gl.code, delta * factor);

    if (line.financialAccountId) {
      addSigned(next.accountBalances, line.financialAccountId, delta);
    }
    if (line.partyType === "customer" && line.partyId) {
      addSigned(next.customerBalances, line.partyId, delta);
    }
    if (line.partyType === "supplier" && line.partyId) {
      addSigned(next.supplierBalances, line.partyId, -delta);
    }
  }

  return next;
}

export function computeBalances(entries: JournalEntry[]): BalanceState {
  return entries.reduce((state, entry) => applyEntry(state, entry), emptyBalanceState());
}
