import {
  buildPurchaseEntry,
  type PurchaseResult
} from "@/core/accounting/engine";
import type { FinancialAccountRef } from "@/core/accounting/types";
import {
  getDB,
  type LocalDebt,
  type LocalJournalEntry,
  type LocalJournalEntryLine,
  type LocalPurchase,
  type MusaedDB
} from "@/core/db/db";
import { saveLocalAttachment } from "@/core/db/attachments";
import {
  enqueueOp,
  makeSyncFields,
  newId,
  tempDocNumber,
  nowIso
} from "@/core/db/repositories";
import {
  derivePurchase,
  purchaseFormSchema,
  type PurchaseFormInput
} from "@/core/validation/purchase";

export interface CreatePurchaseContext {
  businessId: string;
  accountRef?: FinancialAccountRef;
  createdBy?: string;
  receiptFile?: File | null;
}

export interface CreatePurchaseResult {
  purchase: LocalPurchase;
  debt: LocalDebt | null;
  entry: LocalJournalEntry;
  entryLines: LocalJournalEntryLine[];
  receiptAttachmentId: string | null;
}

function mapEngineError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "تعذر تسجيل فاتورة الشراء";
}

export async function createPurchase(
  input: PurchaseFormInput,
  ctx: CreatePurchaseContext,
  db: MusaedDB = getDB()
): Promise<CreatePurchaseResult> {
  const parsed = purchaseFormSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? "بيانات الشراء غير صالحة"
    );
  }

  const purchaseId = newId();
  let derived;
  try {
    derived = derivePurchase(parsed.data, purchaseId, ctx.accountRef);
  } catch (error) {
    throw new Error(mapEngineError(error));
  }

  const { op, netMinor, paidMinor, remainingMinor } = derived;

  const items = (parsed.data.items ?? []).map((item) => ({
    id: newId(),
    productId: item.productId,
    name: item.name,
    quantityMilli: item.quantityMilli,
    unitPriceMinor: item.unitPriceMinor,
    totalMinor: item.totalMinor
  }));

  let engineResult: PurchaseResult;
  try {
    engineResult = buildPurchaseEntry(op);
  } catch (error) {
    throw new Error(mapEngineError(error));
  }

  const createdAt = nowIso();
  const description = parsed.data.description || "بدون وصف";

  const purchase: LocalPurchase = {
    id: purchaseId,
    purchaseNumber: tempDocNumber(),
    supplierId: op.supplierId ?? null,
    occurredAt: op.occurredAt,
    description: parsed.data.description,
    totalAmountMinor: op.totalAmount,
    discountMinor: op.discount,
    netAmountMinor: netMinor,
    paymentMethod: op.paymentMethod,
    accountId: op.account?.id ?? null,
    paidAmountMinor: paidMinor,
    remainingAmountMinor: remainingMinor,
    transferReference: parsed.data.transferReference,
    receiptAttachmentId: null,
    debtId: null,
    status: "posted",
    notes: parsed.data.notes,
    createdBy: ctx.createdBy ?? "",
    postedAt: createdAt,
    ...makeSyncFields({ businessId: ctx.businessId })
  };

  const debt: LocalDebt | null =
    remainingMinor > 0 && op.supplierId
      ? {
          id: newId(),
          direction: "payable",
          partyId: op.supplierId,
          sourceType: "purchase",
          sourceId: purchaseId,
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
    purchase.debtId = debt.id;
  }

  const entryId = newId();
  const entry: LocalJournalEntry = {
    id: entryId,
    entryNumber: tempDocNumber(),
    occurredAt: op.occurredAt,
    description: `فاتورة مشتريات — ${description}`,
    sourceType: "purchase",
    sourceId: purchaseId,
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

  let receiptAttachmentId: string | null = null;
  if (ctx.receiptFile) {
    receiptAttachmentId = await saveLocalAttachment({
      businessId: ctx.businessId,
      entityId: purchaseId,
      entityType: "purchases",
      file: ctx.receiptFile
    });
    purchase.receiptAttachmentId = receiptAttachmentId;
  }

  await db.transaction(
    "rw",
    [
      db.purchases,
      db.debts,
      db.suppliers,
      db.financialAccounts,
      db.journalEntries,
      db.journalEntryLines,
      db.attachmentsMeta,
      db.products,
      db.inventoryMovements,
      db.outbox
    ],
    async () => {
      if (debt && op.supplierId) {
        await db.debts.put(debt);

        const supplier = await db.suppliers.get(op.supplierId);
        if (supplier) {
          await db.suppliers.put({
            ...supplier,
            currentBalanceMinor: supplier.currentBalanceMinor + remainingMinor,
            totalTransactionsMinor:
              supplier.totalTransactionsMinor + netMinor,
            lastTransactionAt: op.occurredAt,
            updatedAt: createdAt,
            version: supplier.version + 1
          });
        }
      }

      if (paidMinor > 0 && op.account) {
        const account = await db.financialAccounts.get(op.account.id);
        if (!account) {
          throw new Error("حساب الدفع غير موجود في القاعدة المحلية");
        }
        await db.financialAccounts.put({
          ...account,
          currentBalanceMinor: account.currentBalanceMinor - paidMinor,
          totalWithdrawalsMinor: account.totalWithdrawalsMinor + paidMinor,
          updatedAt: createdAt,
          version: account.version + 1
        });
      }

      for (const item of items) {
        if (!item.productId) continue;
        const product = await db.products.get(item.productId);
        if (product && product.businessId === ctx.businessId && !product.deletedAt) {
          await db.products.put({
            ...product,
            quantityMilli: product.quantityMilli + item.quantityMilli,
            updatedAt: createdAt,
            version: product.version + 1
          });
        }
        await db.inventoryMovements.put({
          id: newId(),
          businessId: ctx.businessId,
          productId: item.productId,
          type: "in",
          quantityMilli: item.quantityMilli,
          unitCostMinor: item.unitPriceMinor,
          refType: "purchase",
          refId: purchaseId,
          occurredAt: op.occurredAt,
          notes: `شراء — ${item.name}`,
          createdBy: ctx.createdBy ?? ""
        });
      }

      await db.journalEntries.put(entry);
      await db.journalEntryLines.bulkPut(entryLines);
      await db.purchases.put(purchase);

      await enqueueOp({
        db,
        businessId: ctx.businessId,
        opType: "purchase.create",
        entityType: "purchases",
        entityId: purchaseId,
        payload: {
          clientOpId: purchaseId,
          createdAt,
          purchase: {
            id: purchaseId,
            occurredAt: op.occurredAt,
            supplierId: op.supplierId ?? null,
            description: parsed.data.description,
            totalAmountMinor: op.totalAmount,
            discountMinor: op.discount,
            netAmountMinor: netMinor,
            paymentMethod: op.paymentMethod,
            accountId: op.account?.id ?? null,
            paidAmountMinor: paidMinor,
            remainingAmountMinor: remainingMinor,
            transferReference: parsed.data.transferReference,
            receiptAttachmentId: purchase.receiptAttachmentId,
            debtId: purchase.debtId,
            notes: parsed.data.notes
          },
          items:
            items.length > 0
              ? items.map((item) => ({
                  id: item.id,
                  productId: item.productId,
                  name: item.name,
                  quantityMilli: item.quantityMilli,
                  unitPriceMinor: item.unitPriceMinor,
                  totalMinor: item.totalMinor
                }))
              : undefined,
          debt: debt
            ? {
                id: debt.id,
                direction: "payable",
                partyId: debt.partyId,
                amountMinor: debt.amountMinor
              }
            : null
        }
      });
    }
  );

  return {
    purchase,
    debt,
    entry,
    entryLines,
    receiptAttachmentId
  };
}
