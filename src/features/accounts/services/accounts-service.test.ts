import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDB } from "@/core/db/db";
import type {
  AccountAdjustFormInput,
  AccountOperationFormInput,
  AccountTransferFormInput,
  FinancialAccountFormInput,
  FinancialAccountUpdateInput
} from "@/core/validation/account";
import {
  AccountHasBalanceError,
  AccountInactiveError,
  AccountNotFoundError,
  adjustAccountBalance,
  buildAccountStatement,
  createFinancialAccount,
  deleteFinancialAccount,
  depositToAccount,
  setFinancialAccountActive,
  transferBetweenAccounts,
  updateFinancialAccount,
  withdrawFromAccount,
  type AccountContext
} from "./accounts-service";

const BUSINESS_ID = "b0000000-0000-0000-0000-000000000005";
const CASH_ID = "a1000000-0000-0000-0000-000000000005";
const BANK_ID = "a2000000-0000-0000-0000-000000000005";

async function seed() {
  const db = getDB();
  const now = new Date().toISOString();
  await db.businesses.put({
    id: BUSINESS_ID,
    name: "بقالة تجريبية",
    businessType: "grocery",
    ownerId: "00000000-0000-0000-0000-00000000000a",
    currency: "ILS",
    phone: null,
    plan: "free",
    createdAt: now,
    updatedAt: now,
    version: 1
  });
  await db.financialAccounts.bulkPut([
    {
      id: CASH_ID,
      businessId: BUSINESS_ID,
      name: "الصندوق الرئيسي",
      type: "cash",
      provider: null,
      currency: "ILS",
      openingBalanceMinor: 100000,
      currentBalanceMinor: 100000,
      totalDepositsMinor: 0,
      totalWithdrawalsMinor: 0,
      isActive: true,
      updatedAt: now,
      syncStatus: "synced",
      version: 1,
      deletedAt: null
    },
    {
      id: BANK_ID,
      businessId: BUSINESS_ID,
      name: "بنك فلسطين",
      type: "bank",
      provider: "bank_palestine",
      currency: "ILS",
      openingBalanceMinor: 500000,
      currentBalanceMinor: 500000,
      totalDepositsMinor: 0,
      totalWithdrawalsMinor: 0,
      isActive: true,
      updatedAt: now,
      syncStatus: "synced",
      version: 1,
      deletedAt: null
    }
  ]);
}

const ctx: AccountContext = { businessId: BUSINESS_ID };

function accountInput(
  overrides: Partial<FinancialAccountFormInput> = {}
): FinancialAccountFormInput {
  return {
    name: "محفظة Jawwal Pay",
    type: "wallet",
    provider: "jawwal_pay",
    openingBalance: "250.00",
    ...overrides
  };
}

function opInput(
  overrides: Partial<AccountOperationFormInput> = {}
): AccountOperationFormInput {
  return {
    accountId: CASH_ID,
    amount: "150.50",
    occurredAt: new Date("2026-02-01T10:00:00Z").toISOString(),
    notes: "",
    ...overrides
  };
}

function transferInput(
  overrides: Partial<AccountTransferFormInput> = {}
): AccountTransferFormInput {
  return {
    fromAccountId: CASH_ID,
    toAccountId: BANK_ID,
    amount: "200.00",
    occurredAt: new Date("2026-02-01T11:00:00Z").toISOString(),
    notes: "",
    ...overrides
  };
}

function adjustInput(
  overrides: Partial<AccountAdjustFormInput> = {}
): AccountAdjustFormInput {
  return {
    accountId: CASH_ID,
    countedBalance: "990.00",
    occurredAt: new Date("2026-02-01T12:00:00Z").toISOString(),
    notes: "",
    ...overrides
  };
}

async function linesOf(entryId: string) {
  return getDB().journalEntryLines.where("entryId").equals(entryId).toArray();
}

function totalsOf(lines: Array<{ debitMinor: number; creditMinor: number }>) {
  const debit = lines.reduce((sum, line) => sum + line.debitMinor, 0);
  const credit = lines.reduce((sum, line) => sum + line.creditMinor, 0);
  return { debit, credit };
}

describe("createFinancialAccount", () => {
  beforeEach(async () => {
    const db = getDB();
    await Promise.all(db.tables.map((table) => table.clear()));
    await seed();
  });

  it("ينشئ حساباً برصيد افتتاحي ويقيد على 1200 مقابل رأس المال 3100", async () => {
    const result = await createFinancialAccount(accountInput(), ctx);

    expect(result.account.type).toBe("wallet");
    expect(result.account.currentBalanceMinor).toBe(25000);
    expect(result.entry).not.toBeNull();

    const lines = await linesOf(result.entry!.id);
    const { debit, credit } = totalsOf(lines);
    expect(debit).toBe(credit);
    expect(debit).toBe(25000);
    expect(lines.find((line) => line.glCode === "1200")?.debitMinor).toBe(25000);
    expect(
      lines.find((line) => line.glCode === "1200")?.financialAccountId
    ).toBe(result.account.id);
    expect(lines.find((line) => line.glCode === "3100")?.creditMinor).toBe(25000);

    const outboxItems = await getDB().outbox.toArray();
    expect(outboxItems).toHaveLength(1);
    expect(outboxItems[0]?.opType).toBe("entity.upsert");
    expect(outboxItems[0]?.entityId).toBe(result.account.id);
  });

  it("ينشئ حساباً بلا رصيد افتتاحي بلا قيد", async () => {
    const result = await createFinancialAccount(
      accountInput({ openingBalance: "0.00" }),
      ctx
    );

    expect(result.entry).toBeNull();
    expect(result.account.currentBalanceMinor).toBe(0);

    const entries = await getDB().journalEntries.toArray();
    expect(entries).toHaveLength(0);
    const outboxItems = await getDB().outbox.toArray();
    expect(outboxItems).toHaveLength(1);
  });

  it("يرفض اسماً قصيراً وبنكاً بدون مزود", async () => {
    await expect(
      createFinancialAccount(accountInput({ name: "ب" }), ctx)
    ).rejects.toThrow("اسم الحساب مطلوب");

    await expect(
      createFinancialAccount(
        accountInput({ type: "bank", provider: null }),
        ctx
      )
    ).rejects.toThrow("اختر المزود للحسابات البنكية والمحافظ");
  });
});

describe("depositToAccount / withdrawFromAccount", () => {
  beforeEach(async () => {
    const db = getDB();
    await Promise.all(db.tables.map((table) => table.clear()));
    await seed();
  });

  it("إيداع: يزيد الرصيد والإيداعات ويقيد مدين 1100 دائن 3100", async () => {
    const result = await depositToAccount(opInput(), ctx);

    expect(result.account.currentBalanceMinor).toBe(100000 + 15050);
    expect(result.account.totalDepositsMinor).toBe(15050);

    const lines = await linesOf(result.entry.id);
    const { debit, credit } = totalsOf(lines);
    expect(debit).toBe(credit);
    expect(debit).toBe(15050);
    expect(lines.find((line) => line.glCode === "1100")?.debitMinor).toBe(15050);
    expect(lines.find((line) => line.glCode === "3100")?.creditMinor).toBe(15050);

    const outboxItems = await getDB().outbox.toArray();
    expect(outboxItems).toHaveLength(1);
    expect(outboxItems[0]?.opType).toBe("deposit.create");
  });

  it("سحب: يخصم الرصيد ويقيد مدين 3100 دائن 1100", async () => {
    const result = await withdrawFromAccount(
      opInput({ amount: "60.00" }),
      ctx
    );

    expect(result.account.currentBalanceMinor).toBe(100000 - 6000);
    expect(result.account.totalWithdrawalsMinor).toBe(6000);

    const lines = await linesOf(result.entry.id);
    expect(lines.find((line) => line.glCode === "3100")?.debitMinor).toBe(6000);
    expect(lines.find((line) => line.glCode === "1100")?.creditMinor).toBe(6000);

    const outboxItems = await getDB().outbox.toArray();
    expect(outboxItems[0]?.opType).toBe("withdrawal.create");
  });

  it("يرفض سحباً أكبر من الرصيد الحالي", async () => {
    await expect(
      withdrawFromAccount(opInput({ amount: "1001.00" }), ctx)
    ).rejects.toThrow("الرصيد الحالي لا يكفي لعملية السحب");
  });

  it("يرفض العمليات على حساب غير نشط أو محذوف", async () => {
    await setFinancialAccountActive(CASH_ID, false, ctx);
    await expect(depositToAccount(opInput(), ctx)).rejects.toThrow(
      AccountInactiveError
    );

    const db = getDB();
    const account = await db.financialAccounts.get(CASH_ID);
    await db.financialAccounts.put({
      ...account!,
      deletedAt: new Date().toISOString()
    });
    await expect(withdrawFromAccount(opInput(), ctx)).rejects.toThrow(
      AccountNotFoundError
    );
  });
});

describe("transferBetweenAccounts", () => {
  beforeEach(async () => {
    const db = getDB();
    await Promise.all(db.tables.map((table) => table.clear()));
    await seed();
  });

  it("تحويل بقيد واحد متوازن يحرك الحسابين بلا إيراد ولا مصروف", async () => {
    const result = await transferBetweenAccounts(transferInput(), ctx);

    expect(result.fromAccount.currentBalanceMinor).toBe(100000 - 20000);
    expect(result.fromAccount.totalWithdrawalsMinor).toBe(20000);
    expect(result.toAccount.currentBalanceMinor).toBe(500000 + 20000);
    expect(result.toAccount.totalDepositsMinor).toBe(20000);

    expect(result.entry.sourceType).toBe("transfer");
    const lines = await linesOf(result.entry.id);
    expect(lines).toHaveLength(2);
    const { debit, credit } = totalsOf(lines);
    expect(debit).toBe(credit);
    expect(debit).toBe(20000);
    expect(lines.find((line) => line.glCode === "1200")?.debitMinor).toBe(20000);
    expect(lines.find((line) => line.glCode === "1100")?.creditMinor).toBe(20000);

    const glCodes = new Set(lines.map((line) => line.glCode));
    expect(glCodes.has("3100")).toBe(false);
    expect(glCodes.has("4100")).toBe(false);
    expect(glCodes.has("5900")).toBe(false);

    const outboxItems = await getDB().outbox.toArray();
    expect(outboxItems).toHaveLength(1);
    expect(outboxItems[0]?.opType).toBe("transfer.create");
  });

  it("يرفض التحويل إلى نفس الحساب", async () => {
    await expect(
      transferBetweenAccounts(
        transferInput({ toAccountId: CASH_ID }),
        ctx
      )
    ).rejects.toThrow("لا يمكن التحويل إلى نفس الحساب");
  });
});

describe("adjustAccountBalance", () => {
  beforeEach(async () => {
    const db = getDB();
    await Promise.all(db.tables.map((table) => table.clear()));
    await seed();
  });

  it("نقص معدود: تقيد على 5950 وتخفض الرصيد دون المساس بالإحصاءات", async () => {
    const result = await adjustAccountBalance(adjustInput(), ctx);

    expect(result.diffMinor).toBe(-1000);
    expect(result.account.currentBalanceMinor).toBe(99000);
    expect(result.account.totalDepositsMinor).toBe(0);
    expect(result.account.totalWithdrawalsMinor).toBe(0);

    const lines = await linesOf(result.entry!.id);
    const { debit, credit } = totalsOf(lines);
    expect(debit).toBe(credit);
    expect(debit).toBe(1000);
    expect(lines.find((line) => line.glCode === "5950")?.debitMinor).toBe(1000);
    expect(lines.find((line) => line.glCode === "1100")?.creditMinor).toBe(1000);

    const outboxItems = await getDB().outbox.toArray();
    expect(outboxItems[0]?.opType).toBe("adjustment.create");
  });

  it("زيادة معدود: تقيد مدين على الحساب ودائن 5950", async () => {
    const result = await adjustAccountBalance(
      adjustInput({ countedBalance: "1010.00" }),
      ctx
    );

    expect(result.diffMinor).toBe(1000);
    expect(result.account.currentBalanceMinor).toBe(101000);

    const lines = await linesOf(result.entry!.id);
    expect(lines.find((line) => line.glCode === "1100")?.debitMinor).toBe(1000);
    expect(lines.find((line) => line.glCode === "5950")?.creditMinor).toBe(1000);
  });

  it("تسوية بلا فرق: لا قيد ولا عملية مزامنة", async () => {
    const result = await adjustAccountBalance(
      adjustInput({ countedBalance: "1000.00" }),
      ctx
    );

    expect(result.diffMinor).toBe(0);
    expect(result.entry).toBeNull();
    const outboxItems = await getDB().outbox.toArray();
    expect(outboxItems).toHaveLength(0);
  });
});

describe("CRUD", () => {
  beforeEach(async () => {
    const db = getDB();
    await Promise.all(db.tables.map((table) => table.clear()));
    await seed();
  });

  it("تعديل الاسم والمزود يرفع الإصدار ويضع عملية upsert", async () => {
    const input: FinancialAccountUpdateInput = {
      name: "بنك فلسطين — فرع رام الله",
      provider: "other"
    };
    const result = await updateFinancialAccount(BANK_ID, input, ctx);

    expect(result.account.name).toBe(input.name);
    expect(result.account.provider).toBe("other");
    expect(result.account.version).toBe(2);

    const outboxItems = await getDB().outbox.toArray();
    expect(outboxItems).toHaveLength(1);
    expect(outboxItems[0]?.opType).toBe("entity.upsert");
    const payload = outboxItems[0]?.payload as { op: string; id: string };
    expect(payload.op).toBe("update");
    expect(payload.id).toBe(BANK_ID);
  });

  it("الأرشفة والتنشيط عبر setFinancialAccountActive", async () => {
    const archived = await setFinancialAccountActive(BANK_ID, false, ctx);
    expect(archived.account.isActive).toBe(false);

    const restored = await setFinancialAccountActive(BANK_ID, true, ctx);
    expect(restored.account.isActive).toBe(true);
  });

  it("يرفض حذف حساب برصيد غير صفري", async () => {
    await expect(deleteFinancialAccount(CASH_ID, ctx)).rejects.toThrow(
      AccountHasBalanceError
    );
  });

  it("يحذف حساباً صفري الرصيد بحذف ناعم وعملية soft_delete", async () => {
    const created = await createFinancialAccount(
      accountInput({ name: "حساب مؤقت", openingBalance: "0.00" }),
      ctx
    );

    await deleteFinancialAccount(created.account.id, ctx);

    const deleted = await getDB().financialAccounts.get(created.account.id);
    expect(deleted?.deletedAt).not.toBeNull();
    expect(deleted?.isActive).toBe(false);

    const outboxItems = await getDB().outbox.toArray();
    const softDeleteOps = outboxItems.filter(
      (item) => item.opType === "entity.soft_delete"
    );
    expect(softDeleteOps).toHaveLength(1);
    expect(softDeleteOps[0]?.entityId).toBe(created.account.id);
  });
});

describe("buildAccountStatement", () => {
  beforeEach(async () => {
    const db = getDB();
    await Promise.all(db.tables.map((table) => table.clear()));
    await seed();
  });

  it("كشف الحساب: افتتاحي محسوب عكسياً وصفوف زمنية برصيد بعده", async () => {
    const earlier = new Date("2026-02-01T10:00:00Z").toISOString();
    const later = new Date("2026-02-02T10:00:00Z").toISOString();

    await depositToAccount(
      opInput({ amount: "150.00", occurredAt: earlier }),
      ctx
    );
    await withdrawFromAccount(
      opInput({ amount: "50.00", occurredAt: later }),
      ctx
    );

    const statement = await buildAccountStatement(CASH_ID);

    expect(statement.rows).toHaveLength(2);
    expect(statement.currentBalanceMinor).toBe(100000 + 15000 - 5000);
    expect(statement.openingBalanceMinor).toBe(100000);

    const [firstRow, secondRow] = statement.rows;
    if (!firstRow || !secondRow) throw new Error("expected two statement rows");
    expect(firstRow.sourceType).toBe("deposit");
    expect(firstRow.amountMinor).toBe(15000);
    expect(firstRow.balanceAfterMinor).toBe(115000);
    expect(secondRow.sourceType).toBe("withdrawal");
    expect(secondRow.amountMinor).toBe(-5000);
    expect(secondRow.balanceAfterMinor).toBe(110000);
  });

  it("يشمل التحويلات ويحسب الافتتاحي مع سطر قيد الافتتاح", async () => {
    const created = await createFinancialAccount(accountInput(), ctx);

    await transferBetweenAccounts(
      transferInput({
        fromAccountId: BANK_ID,
        toAccountId: created.account.id,
        occurredAt: new Date(Date.now() + 60000).toISOString()
      }),
      ctx
    );

    const statement = await buildAccountStatement(created.account.id);

    expect(statement.rows).toHaveLength(2);
    expect(statement.openingBalanceMinor).toBe(0);
    expect(statement.rows[0]?.sourceType).toBe("opening");
    expect(statement.rows[0]?.amountMinor).toBe(25000);
    expect(statement.rows[0]?.balanceAfterMinor).toBe(25000);
    expect(statement.rows[1]?.sourceType).toBe("transfer");
    expect(statement.rows[1]?.amountMinor).toBe(20000);
    expect(statement.rows[1]?.balanceAfterMinor).toBe(45000);
    expect(statement.currentBalanceMinor).toBe(45000);
  });

  it("يرفض كشف حساب غير موجود", async () => {
    await expect(
      buildAccountStatement("00000000-0000-0000-0000-000000000009")
    ).rejects.toThrow(AccountNotFoundError);
  });
});
