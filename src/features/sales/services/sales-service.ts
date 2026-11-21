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

export interface CreateSaleContext {
  businessId: string;
  accountRef?: FinancialAccountRef;
  createdBy?: string;
}

export interface CreateSaleResult {
  sale: LocalSale;
  debt: LocalDebt | null;
  entry: LocalJournalEntry;
  entryLines: LocalJournalEntryLine[];
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
      db.outbox
    ],
    async () => {
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

  return { sale, debt, entry, entryLines };
}
