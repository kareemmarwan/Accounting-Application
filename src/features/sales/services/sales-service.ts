import { buildSaleEntry, type SaleResult } from "@/core/accounting/engine";
import type { FinancialAccountRef } from "@/core/accounting/types";
import {
  getDB,
  type LocalDebt,
  type LocalJournalEntry,
  type LocalJournalEntryLine,
  type LocalSale,
  type MusaedDB
} from "@/core/db/db";
import {
  enqueueOp,
  makeSyncFields,
  newId,
  tempDocNumber,
  nowIso
} from "@/core/db/repositories";
import {
  deriveSale,
  saleFormSchema,
  type SaleFormInput
} from "@/core/validation/sale";

export interface SaleItemDraft {
  id: string;
  productId: string | null;
  name: string;
  quantityMilli: number;
  unitPriceMinor: number;
  totalMinor: number;
  lineNote: string;
}

export interface CreateSaleContext {
  businessId: string;
  accountRef?: FinancialAccountRef;
  createdBy?: string;
  items?: SaleItemDraft[];
}

export interface CreateSaleResult {
  sale: LocalSale;
  debt: LocalDebt | null;
  entry: LocalJournalEntry;
  entryLines: LocalJournalEntryLine[];
  items: SaleItemDraft[];
}

function mapEngineError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "تعذر تسجيل عملية البيع";
}

export async function createSale(
  input: SaleFormInput,
  ctx: CreateSaleContext,
  db: MusaedDB = getDB()
): Promise<CreateSaleResult> {
  const parsed = saleFormSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? "بيانات البيع غير صالحة"
    );
  }

  const saleId = newId();
  let derived;
  try {
    derived = deriveSale(parsed.data, saleId, ctx.accountRef);
  } catch (error) {
    throw new Error(mapEngineError(error));
  }

  const { op, netMinor, paidMinor, remainingMinor } = derived;

  const items = ctx.items ?? [];
  let itemLines: SaleItemDraft[] = [];
  if (items.length > 0) {
    let sum = 0;
    for (const item of items) {
      if (!Number.isInteger(item.quantityMilli) || item.quantityMilli <= 0) {
        throw new Error("كمية صنف غير صالحة في الفاتورة");
      }
      if (item.totalMinor !== Math.round((item.quantityMilli * item.unitPriceMinor) / 1000)) {
        throw new Error("مجموع سطر لا يطابق الكمية × السعر");
      }
      if (!item.name.trim()) {
        throw new Error("اسم الصنف مطلوب");
      }
      sum += item.totalMinor;
    }
    if (sum !== op.totalAmount) {
      throw new Error("مجموع السطور لا يطابق إجمالي الفاتورة");
    }
    itemLines = items;
  }

  let engineResult: SaleResult;
  try {
    engineResult = buildSaleEntry(op);
  } catch (error) {
    throw new Error(mapEngineError(error));
  }

  const createdAt = nowIso();
  const description = parsed.data.description || "بدون وصف";

  const sale: LocalSale = {
    id: saleId,
    saleNumber: tempDocNumber(),
    customerId: op.customerId ?? null,
    occurredAt: op.occurredAt,
    description: parsed.data.description,
    totalAmountMinor: op.totalAmount,
    discountMinor: op.discount,
    netAmountMinor: netMinor,
    paymentMethod: op.paymentMethod,
    accountId: op.account?.id ?? null,
    paidAmountMinor: paidMinor,
    remainingAmountMinor: remainingMinor,
    debtId: null,
    status: "posted",
    notes: parsed.data.notes,
    createdBy: ctx.createdBy ?? "",
    postedAt: createdAt,
    ...makeSyncFields({ businessId: ctx.businessId })
  };

  const debt: LocalDebt | null =
    remainingMinor > 0 && op.customerId
      ? {
          id: newId(),
          direction: "receivable",
          partyId: op.customerId,
          sourceType: "sale",
          sourceId: saleId,
          amountMinor: remainingMinor,
          paidAmountMinor: 0,
          remainingAmountMinor: remainingMinor,
          dueDate: null,
          status: "open",
          notes: "",
          createdAt,
          ...makeSyncFields({ businessId: ctx.businessId })
        }
      : null;

  if (debt) {
    sale.debtId = debt.id;
  }

  const entryId = newId();
  const entry: LocalJournalEntry = {
    id: entryId,
    entryNumber: tempDocNumber(),
    occurredAt: op.occurredAt,
    description: `عملية بيع — ${description}`,
    sourceType: "sale",
    sourceId: saleId,
    status: "posted",
    reversalOfEntryId: null,
    ...makeSyncFields({ businessId: ctx.businessId })
  };

  const entryLines: LocalJournalEntryLine[] = engineResult.entry.lines.map(
    (line) => ({
      id: newId(),
      businessId: ctx.businessId,
      entryId,
      glCode: line.glCode,
      debitMinor: line.debit,
      creditMinor: line.credit,
      financialAccountId: line.financialAccountId ?? null,
      partyType: line.partyType ?? null,
      partyId: line.partyId ?? null
    })
  );

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
      if (itemLines.length > 0) {
        await db.saleItems.bulkPut(
          itemLines.map((item) => ({
            id: item.id,
            businessId: ctx.businessId,
            saleId: saleId,
            productId: item.productId,
            name: item.name,
            quantityMilli: item.quantityMilli,
            unitPriceMinor: item.unitPriceMinor,
            totalMinor: item.totalMinor,
            lineNote: item.lineNote
          }))
        );

        for (const item of itemLines) {
          if (!item.productId) continue;
          const product = await db.products.get(item.productId);
          if (!product || product.deletedAt) continue;
          if (product.businessId !== ctx.businessId) continue;
          if (product.quantityMilli <= 0) continue;
          const updatedProduct = {
            ...product,
            quantityMilli: product.quantityMilli - item.quantityMilli,
            updatedAt: createdAt,
            syncStatus: product.syncStatus === "synced" ? ("pending" as const) : product.syncStatus,
            version: product.version + 1
          };
          await db.products.put(updatedProduct);
          await db.inventoryMovements.put({
            id: newId(),
            businessId: ctx.businessId,
            productId: product.id,
            type: "out",
            quantityMilli: item.quantityMilli,
            unitCostMinor: product.purchasePriceMinor > 0 ? product.purchasePriceMinor : null,
            refType: "sale",
            refId: saleId,
            occurredAt: op.occurredAt,
            notes: "",
            createdBy: ctx.createdBy ?? ""
          });
        }
      }

      if (debt && op.customerId) {
        await db.debts.put(debt);

        const customer = await db.customers.get(op.customerId);
        if (customer) {
          await db.customers.put({
            ...customer,
            currentBalanceMinor: customer.currentBalanceMinor + remainingMinor,
            totalTransactionsMinor: customer.totalTransactionsMinor + netMinor,
            lastTransactionAt: op.occurredAt,
            updatedAt: createdAt,
            version: customer.version + 1
          });
        }
      }

      if (paidMinor > 0 && op.account) {
        const account = await db.financialAccounts.get(op.account.id);
        if (!account) {
          throw new Error("حساب الاستلام غير موجود في القاعدة المحلية");
        }
        await db.financialAccounts.put({
          ...account,
          currentBalanceMinor: account.currentBalanceMinor + paidMinor,
          totalDepositsMinor: account.totalDepositsMinor + paidMinor,
          updatedAt: createdAt,
          version: account.version + 1
        });
      }

      await db.journalEntries.put(entry);
      await db.journalEntryLines.bulkPut(entryLines);
      await db.sales.put(sale);

      await enqueueOp({
        db,
        businessId: ctx.businessId,
        opType: "sale.create",
        entityType: "sales",
        entityId: saleId,
        payload: {
          clientOpId: saleId,
          createdAt,
          sale: {
            id: saleId,
            occurredAt: op.occurredAt,
            customerId: op.customerId ?? null,
            description: parsed.data.description,
            totalAmountMinor: op.totalAmount,
            discountMinor: op.discount,
            netAmountMinor: netMinor,
            paymentMethod: op.paymentMethod,
            accountId: op.account?.id ?? null,
            paidAmountMinor: paidMinor,
            remainingAmountMinor: remainingMinor,
            debtId: sale.debtId,
            notes: parsed.data.notes
          },
          items:
            itemLines.length > 0
              ? itemLines.map((item) => ({
                  id: item.id,
                  productId: item.productId,
                  name: item.name,
                  quantityMilli: item.quantityMilli,
                  unitPriceMinor: item.unitPriceMinor,
                  totalMinor: item.totalMinor,
                  lineNote: item.lineNote || null
                }))
              : undefined,
          debt: debt
            ? {
                id: debt.id,
                direction: "receivable",
                partyId: debt.partyId,
                amountMinor: debt.amountMinor
              }
            : null
        }
      });
    }
  );

  return { sale, debt, entry, entryLines, items: itemLines };
}
