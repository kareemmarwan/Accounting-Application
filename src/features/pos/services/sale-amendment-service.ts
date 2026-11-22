import { buildSaleEntry, type SaleResult } from "@/core/accounting/engine";
import type { FinancialAccountRef, CashPaymentMethod } from "@/core/accounting/types";
import { getDB, type LocalDebt, type LocalSale, type MusaedDB } from "@/core/db/db";
import { enqueueOp, newId, nowIso, tempDocNumber } from "@/core/db/repositories";
import { lineTotalMinor, validateCart, type PosCartLine } from "@/features/pos/cart";

export interface AmendSaleInput {
  saleId: string;
  newLines: PosCartLine[];
  paymentMethod: CashPaymentMethod;
  accountId: string;
  paidAmountMinor: number;
  customerId: string;
  notes: string;
}

export interface AmendSaleContext {
  businessId: string;
  accountRef?: FinancialAccountRef;
  createdBy?: string;
}

export interface AmendSaleResult {
  sale: LocalSale;
  deltaMinor: number;
  paidMinor: number;
  remainingMinor: number;
  debt: LocalDebt | null;
  addedCount: number;
}

function toEntryOp(input: {
  saleId: string;
  deltaMinor: number;
  paidMinor: number;
  paymentMethod: CashPaymentMethod;
  account?: FinancialAccountRef;
  customerId?: string;
  occurredAt: string;
}): Parameters<typeof buildSaleEntry>[0] {
  return {
    saleId: input.saleId,
    occurredAt: input.occurredAt,
    customerId: input.customerId,
    totalAmount: input.deltaMinor,
    discount: 0,
    paymentMethod: input.paymentMethod,
    account: input.account,
    paidAmount: input.paidMinor
  };
}

export async function amendSale(
  input: AmendSaleInput,
  ctx: AmendSaleContext,
  db: MusaedDB = getDB()
): Promise<AmendSaleResult> {
  const validation = validateCart(input.newLines, 0);
  if (!validation.ok) {
    throw new Error(validation.error ?? "الإضافة غير صالحة");
  }

  const sale = await db.sales.get(input.saleId);
  if (!sale || sale.deletedAt) {
    throw new Error("الفاتورة غير موجودة");
  }
  if (sale.businessId !== ctx.businessId) {
    throw new Error("الفاتورة لا تنتمي لهذا المشروع");
  }
  if (sale.status === "void") {
    throw new Error("لا إضافة على فاتورة ملغاة");
  }

  const items = input.newLines.map((line) => ({
    id: crypto.randomUUID(),
    productId: line.productId,
    name: line.name,
    quantityMilli: line.quantityMilli,
    unitPriceMinor: line.unitPriceMinor,
    totalMinor: lineTotalMinor(line),
    lineNote: line.lineNote
  }));

  const deltaMinor = items.reduce((sum, item) => sum + item.totalMinor, 0);
  const paidMinor =
    input.paymentMethod === "cash"
      ? Math.min(Math.max(0, input.paidAmountMinor), deltaMinor)
      : Math.max(0, input.paidAmountMinor);
  if (input.paymentMethod !== "cash" && paidMinor > deltaMinor) {
    throw new Error("المبلغ المدفوع أكبر من قيمة الإضافة");
  }
  const remainingMinor = deltaMinor - paidMinor;

  const customerId = input.customerId || sale.customerId || "";
  if (remainingMinor > 0 && !customerId) {
    throw new Error("الجزء الآجل يتطلب تحديد العميل");
  }
  if (paidMinor > 0 && !input.accountId) {
    throw new Error("حدد الحساب المستلم للمبلغ المدفوع");
  }

  let engineResult: SaleResult;
  try {
    engineResult = buildSaleEntry(
      toEntryOp({
        saleId: sale.id,
        deltaMinor,
        paidMinor,
        paymentMethod: input.paymentMethod,
        account: paidMinor > 0 ? ctx.accountRef : undefined,
        customerId: customerId || undefined,
        occurredAt: sale.occurredAt
      })
    );
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "قيد الإضافة غير صالح");
  }

  const createdAt = nowIso();
  const opId = newId();

  const newItems = items;
  const updatedAt = createdAt;

  const updatedSale: LocalSale = {
    ...sale,
    totalAmountMinor: sale.totalAmountMinor + deltaMinor,
    netAmountMinor: sale.netAmountMinor + deltaMinor,
    paidAmountMinor: sale.paidAmountMinor + paidMinor,
    remainingAmountMinor: sale.remainingAmountMinor + remainingMinor,
    notes: input.notes ? `${sale.notes} ${input.notes}`.trim() : sale.notes,
    updatedAt,
    syncStatus: sale.syncStatus === "synced" ? "pending" : sale.syncStatus,
    version: sale.version + 1
  };

  let debt: LocalDebt | null = null;
  let debtIdForSale = sale.debtId;
  if (remainingMinor > 0 && customerId) {
    const existingDebt = sale.debtId ? await db.debts.get(sale.debtId) : undefined;
    if (existingDebt && !existingDebt.deletedAt) {
      debt = {
        ...existingDebt,
        amountMinor: existingDebt.amountMinor + remainingMinor,
        remainingAmountMinor: existingDebt.remainingAmountMinor + remainingMinor,
        status:
          existingDebt.remainingAmountMinor + remainingMinor > 0
            ? existingDebt.paidAmountMinor > 0
              ? "partial"
              : "open"
            : "settled",
        updatedAt,
        syncStatus: existingDebt.syncStatus === "synced" ? "pending" : existingDebt.syncStatus,
        version: existingDebt.version + 1
      };
      debtIdForSale = debt.id;
    } else {
      debt = {
        id: newId(),
        direction: "receivable",
        partyId: customerId,
        sourceType: "sale",
        sourceId: sale.id,
        amountMinor: remainingMinor,
        paidAmountMinor: 0,
        remainingAmountMinor: remainingMinor,
        dueDate: null,
        status: "open",
        notes: "",
        createdAt,
        businessId: ctx.businessId,
        updatedAt,
        syncStatus: "pending",
        version: 1,
        deletedAt: null
      };
      debtIdForSale = debt.id;
    }
  }

  const entryId = newId();
  const entry = {
    id: entryId,
    entryNumber: tempDocNumber(),
    occurredAt: sale.occurredAt,
    description: `إضافة إلى فاتورة بيع ${sale.saleNumber}`,
    sourceType: "sale" as const,
    sourceId: sale.id,
    status: "posted" as const,
    reversalOfEntryId: null,
    businessId: ctx.businessId,
    updatedAt,
    syncStatus: "pending" as const,
    version: 1,
    deletedAt: null
  };

  const entryLines = engineResult.entry.lines.map((line) => ({
    id: newId(),
    businessId: ctx.businessId,
    entryId,
    glCode: line.glCode,
    debitMinor: line.debit,
    creditMinor: line.credit,
    financialAccountId: line.financialAccountId ?? null,
    partyType: line.partyType ?? null,
    partyId: line.partyId ?? null
  }));

  await db.transaction(
    "rw",
    [
      db.sales,
      db.debts,
      db.customers,
      db.financialAccounts,
      db.journalEntries,
      db.journalEntryLines,
      db.products,
      db.saleItems,
      db.inventoryMovements,
      db.outbox
    ],
    async () => {
      await db.saleItems.bulkPut(
        newItems.map((item) => ({
          id: item.id,
          businessId: ctx.businessId,
          saleId: sale.id,
          productId: item.productId,
          name: item.name,
          quantityMilli: item.quantityMilli,
          unitPriceMinor: item.unitPriceMinor,
          totalMinor: item.totalMinor,
          lineNote: item.lineNote
        }))
      );

      for (const item of newItems) {
        if (!item.productId) continue;
        const product = await db.products.get(item.productId);
        if (!product || product.deletedAt) continue;
        if (product.businessId !== ctx.businessId) continue;
        if (product.quantityMilli <= 0) continue;
        await db.products.put({
          ...product,
          quantityMilli: product.quantityMilli - item.quantityMilli,
          updatedAt,
          syncStatus: product.syncStatus === "synced" ? ("pending" as const) : product.syncStatus,
          version: product.version + 1
        });
        await db.inventoryMovements.put({
          id: newId(),
          businessId: ctx.businessId,
          productId: product.id,
          type: "out",
          quantityMilli: item.quantityMilli,
          unitCostMinor: product.purchasePriceMinor > 0 ? product.purchasePriceMinor : null,
          refType: "sale",
          refId: sale.id,
          occurredAt: createdAt,
          notes: "إضافة إلى فاتورة",
          createdBy: ctx.createdBy ?? ""
        });
      }

      if (paidMinor > 0 && input.accountId) {
        const account = await db.financialAccounts.get(input.accountId);
        if (!account) {
          throw new Error("حساب الاستلام غير موجود في القاعدة المحلية");
        }
        await db.financialAccounts.put({
          ...account,
          currentBalanceMinor: account.currentBalanceMinor + paidMinor,
          totalDepositsMinor: account.totalDepositsMinor + paidMinor,
          updatedAt,
          version: account.version + 1
        });
      }

      if (debt) {
        await db.debts.put(debt);
        const customer = await db.customers.get(customerId);
        if (customer) {
          await db.customers.put({
            ...customer,
            currentBalanceMinor: customer.currentBalanceMinor + remainingMinor,
            totalTransactionsMinor: customer.totalTransactionsMinor + deltaMinor,
            lastTransactionAt: createdAt,
            updatedAt,
            version: customer.version + 1
          });
        }
      } else if (customerId) {
        const customer = await db.customers.get(customerId);
        if (customer) {
          await db.customers.put({
            ...customer,
            totalTransactionsMinor: customer.totalTransactionsMinor + deltaMinor,
            lastTransactionAt: createdAt,
            updatedAt,
            version: customer.version + 1
          });
        }
      }

      await db.journalEntries.put(entry);
      await db.journalEntryLines.bulkPut(entryLines);
      await db.sales.put({ ...updatedSale, debtId: debtIdForSale });

      await enqueueOp({
        db,
        businessId: ctx.businessId,
        opType: "sale.add_items",
        entityType: "sales",
        entityId: sale.id,
        payload: {
          clientOpId: opId,
          createdAt,
          saleId: sale.id,
          items: newItems.map((item) => ({
            id: item.id,
            productId: item.productId,
            name: item.name,
            quantityMilli: item.quantityMilli,
            unitPriceMinor: item.unitPriceMinor,
            totalMinor: item.totalMinor,
            lineNote: item.lineNote || null
          })),
          totalMinor: deltaMinor,
          paidAmountMinor: paidMinor,
          paymentMethod: input.paymentMethod,
          accountId: paidMinor > 0 ? input.accountId : null,
          customerId: customerId || null,
          debtId: remainingMinor > 0 && !sale.debtId ? debtIdForSale : null,
          occurredAt: createdAt,
          notes: input.notes
        }
      });
    }
  );

  return {
    sale: { ...updatedSale, debtId: debtIdForSale },
    deltaMinor,
    paidMinor,
    remainingMinor,
    debt,
    addedCount: newItems.length
  };
}
