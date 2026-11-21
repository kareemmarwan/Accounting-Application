import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDB, type LocalParty } from "@/core/db/db";
import { buildManualDebtEntry } from "@/core/accounting/engine";
import type { ContactFormInput, ManualDebtInput } from "@/core/validation/contact";
import {
  buildContactLedger,
  createContact,
  createManualDebt,
  softDeleteContact,
  updateContact
} from "./contacts-service";

const BUSINESS_ID = "b0000000-0000-0000-0000-000000000004";
const CUSTOMER_ID = "c0000000-0000-0000-0000-000000000004";
const SUPPLIER_ID = "d0000000-0000-0000-0000-000000000004";

const contactInput: ContactFormInput = {
  name: "أبو خالد",
  phone: "0599123456",
  address: "غزة",
  notes: ""
};

describe("contacts-service", () => {
  beforeEach(async () => {
    const db = getDB();
    await Promise.all(db.tables.map((table) => table.clear()));
    const now = new Date().toISOString();
    await db.businesses.put({
      id: BUSINESS_ID,
      name: "مشروع الاختبار",
      businessType: "grocery",
      ownerId: "00000000-0000-0000-0000-00000000000b",
      currency: "ILS",
      phone: null,
      plan: "free",
      createdAt: now,
      updatedAt: now,
      version: 1
    });
  });

  it("ينشئ عميلاً ومورداً ويرصدهما في القاعدة المحلية مع Outbox", async () => {
    const customer = await createContact(contactInput, "customer", {
      businessId: BUSINESS_ID
    });
    expect(customer.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(customer.name).toBe("أبو خالد");
    expect(customer.currentBalanceMinor).toBe(0);

    const supplier = await createContact(
      { ...contactInput, name: "مؤسسة النور" },
      "supplier",
      { businessId: BUSINESS_ID }
    );
    expect(supplier.id).not.toBe(customer.id);

    const outbox = await getDB().outbox.toArray();
    expect(outbox.filter((op) => op.opType === "entity.upsert")).toHaveLength(2);
  });

  it("يعدّل بيانات الجهة ويزيد الإصدار", async () => {
    const party = await createContact(contactInput, "customer", {
      businessId: BUSINESS_ID
    });
    const updated = await updateContact(
      party.id,
      { ...contactInput, name: "أبو خالد الشمالي", phone: "0598" },
      "customer"
    );
    expect(updated.name).toBe("أبو خالد الشمالي");
    expect(updated.version).toBe(party.version + 1);
    const outbox = await getDB().outbox.toArray();
    expect(outbox.some((op) => op.payload && typeof op.payload === "object" && "expectedVersion" in op.payload)).toBe(true);
  });

  it("يرفض الحذف برصيد غير صفري ويسمح برصيد صفري", async () => {
    const party = await createContact(contactInput, "customer", {
      businessId: BUSINESS_ID
    });
    const db = getDB();
    await db.customers.put({
      ...party,
      currentBalanceMinor: 5000
    });
    await expect(softDeleteContact(party.id, "customer")).rejects.toThrow(
      /رصيد غير صفري/
    );

    await db.customers.put({ ...party, currentBalanceMinor: 0 });
    await softDeleteContact(party.id, "customer");
    const row = await db.customers.get(party.id);
    expect(row?.deletedAt).not.toBeNull();
  });

  it("دفتر دين جهة بلا حركات = رصيد صفري وسطر الافتتاح محسوب عكسياً", async () => {
    const party = await createContact(contactInput, "customer", {
      businessId: BUSINESS_ID
    });
    const ledger = await buildContactLedger(party.id, "customer");
    expect(ledger.rows).toHaveLength(0);
    expect(ledger.currentBalanceMinor).toBe(0);
    expect(ledger.openingBalanceMinor).toBe(0);
  });

  it("الدين اليدوي يرفع رصيد الجهة ويوازن القيد ويظهر في الدفتر", async () => {
    const supplier = await createContact(
      { ...contactInput, name: "مورد قديم" },
      "supplier",
      { businessId: BUSINESS_ID }
    );
    const debtInput: ManualDebtInput = {
      partyId: supplier.id,
      amount: "150.50",
      occurredAt: new Date("2026-01-01").toISOString(),
      notes: "دين قديم"
    };

    const { debt, entryLines } = await createManualDebt(
      debtInput,
      "supplier",
      { businessId: BUSINESS_ID }
    );

    expect(debt.amountMinor).toBe(15050);
    expect(debt.remainingAmountMinor).toBe(15050);
    expect(debt.status).toBe("open");
    expect(debt.direction).toBe("payable");

    const debitSum = entryLines.reduce((sum, line) => sum + line.debitMinor, 0);
    const creditSum = entryLines.reduce((sum, line) => sum + line.creditMinor, 0);
    expect(debitSum).toBe(creditSum);
    expect(debitSum).toBe(15050);

    const updatedSupplier = (await getDB().suppliers.get(supplier.id)) as LocalParty;
    expect(updatedSupplier.currentBalanceMinor).toBe(15050);

    const ledger = await buildContactLedger(supplier.id, "supplier");
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]!.deltaMinor).toBe(15050);
    expect(ledger.rows[0]!.balanceAfterMinor).toBe(15050);
    expect(ledger.openingBalanceMinor).toBe(0);
  });

  it("دفتر دين يعكس الدفعات (نقصان) بعد الدين اليدوي", async () => {
    const customer = await createContact(contactInput, "customer", {
      businessId: BUSINESS_ID
    });
    const db = getDB();
    const paymentId = "f0000000-0000-0000-0000-000000000005";
    const now = new Date().toISOString();

    const { debt } = await createManualDebt(
      {
        partyId: customer.id,
        amount: "100",
        occurredAt: now,
        notes: ""
      },
      "customer",
      { businessId: BUSINESS_ID }
    );

    await db.debtPayments.put({
      id: paymentId,
      businessId: BUSINESS_ID,
      debtId: debt.id,
      amountMinor: 10000,
      occurredAt: new Date(Date.now() + 3600_000).toISOString(),
      accountId: ACCOUNT_ID_STUB,
      paymentMethod: "cash",
      journalEntryId: null,
      notes: "دفعة كاملة",
      createdBy: "",
      updatedAt: now,
      syncStatus: "synced",
      version: 1,
      deletedAt: null
    });
    const party = await db.customers.get(customer.id);
    await db.customers.put({
      ...party!,
      currentBalanceMinor: 0
    });

    const ledger = await buildContactLedger(customer.id, "customer");
    expect(ledger.rows).toHaveLength(2);
    expect(ledger.rows[0]!.deltaMinor).toBe(10000);
    expect(ledger.rows[1]!.deltaMinor).toBe(-10000);
    expect(ledger.rows[1]!.balanceAfterMinor).toBe(0);
  });
});

const ACCOUNT_ID_STUB = "a0000000-0000-0000-0000-000000000006";

describe("buildManualDebtEntry", () => {
  it("قيد الدين اليدوي على العميل: مدين عملاء / دائن رأس المال", () => {
    const { entry } = buildManualDebtEntry({
      debtId: CUSTOMER_ID,
      direction: "receivable",
      partyId: CUSTOMER_ID,
      occurredAt: new Date().toISOString(),
      amount: 5000
    });
    expect(entry.lines).toHaveLength(2);
    expect(entry.lines[0]).toMatchObject({
      glCode: "1300",
      debit: 5000,
      credit: 0,
      partyType: "customer",
      partyId: CUSTOMER_ID
    });
    expect(entry.lines[1]).toMatchObject({ glCode: "3100", debit: 0, credit: 5000 });
  });

  it("قيد الدين اليدوي على المورد: مدين رأس المال / دائن موردون", () => {
    const { entry } = buildManualDebtEntry({
      debtId: SUPPLIER_ID,
      direction: "payable",
      partyId: SUPPLIER_ID,
      occurredAt: new Date().toISOString(),
      amount: 3000
    });
    expect(entry.lines[0]).toMatchObject({ glCode: "3100", debit: 3000 });
    expect(entry.lines[1]).toMatchObject({
      glCode: "2100",
      credit: 3000,
      partyType: "supplier",
      partyId: SUPPLIER_ID
    });
  });

  it("يرفض مبلغاً صفراً أو سالباً", () => {
    expect(() =>
      buildManualDebtEntry({
        debtId: CUSTOMER_ID,
        direction: "receivable",
        partyId: CUSTOMER_ID,
        occurredAt: new Date().toISOString(),
        amount: 0
      })
    ).toThrow();
  });
});
