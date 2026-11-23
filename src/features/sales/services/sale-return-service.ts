import { getDB, type LocalJournalEntryLine, type LocalSale, type MusaedDB } from "@/core/db/db";
import { enqueueOp, newId, nowIso, tempDocNumber } from "@/core/db/repositories";

export interface SaleReturnLineInput {
  saleItemId: string;
  quantityMilli: number;
}

export interface ReturnSaleInput {
  saleId: string;
  lines: SaleReturnLineInput[];
  reason: string;
  refundAccountId: string;
}

export interface ReturnSaleContext {
  businessId: string;
  createdBy?: string;
}

export interface ReturnSplit {
  returnMinor: number;
  debtReducedMinor: number;
  refundMinor: number;
}

export interface ReturnSaleResult extends ReturnSplit {
  sale: LocalSale;
}

export async function computeReturnSplit(
  saleId: string,
  lines: SaleReturnLineInput[],
  db: MusaedDB = getDB()
): Promise<ReturnSplit> {
  const sale = await db.sales.get(saleId);
  if (!sale) throw new Error("الفاتورة غير موجودة");

  let returnMinor = 0;
  for (const line of lines) {
    const item = await db.saleItems.get(line.saleItemId);
    if (!item || item.saleId !== saleId) continue;
    returnMinor += Math.round((line.quantityMilli * item.unitPriceMinor) / 1000);
  }

  let debtReducedMinor = 0;
  if (sale.debtId) {
    const debt = await db.debts.get(sale.debtId);
    if (debt && !debt.deletedAt) {
      debtReducedMinor = Math.min(returnMinor, debt.remainingAmountMinor);
    }
  }

  return {
    returnMinor,
    debtReducedMinor,
    refundMinor: returnMinor - debtReducedMinor
  };
}

export async function returnSaleItems(
  input: ReturnSaleInput,
  ctx: ReturnSaleContext,
  db: MusaedDB = getDB()
): Promise<ReturnSaleResult> {
  const sale = await db.sales.get(input.saleId);
  if (!sale || sale.deletedAt) {
    throw new Error("الفاتورة غير موجودة");
  }
  if (sale.businessId !== ctx.businessId) {
    throw new Error("الفاتورة لا تنتمي لهذا المشروع");
  }
  if (sale.status === "void") {
    throw new Error("لا إرجاع على فاتورة ملغاة — استخدم الإلغاء");
  }
  if (input.lines.length === 0) {
    throw new Error("حدد أصنافاً للإرجاع");
  }
  const reason = input.reason.trim();
  if (reason.length < 3) {
    throw new Error("سبب الإرجاع مطلوب (3 أحرف على الأقل)");
  }

  const split = await computeReturnSplit(input.saleId, input.lines, db);
  if (split.returnMinor <= 0) {
    throw new Error("قيمة الإرجاع يجب أن تكون أكبر من صفر");
  }

  for (const line of input.lines) {
    const item = await db.saleItems.get(line.saleItemId);
    if (!item || item.saleId !== input.saleId) {
      throw new Error("سطر إرجاع غير موجود في الفاتورة");
    }
    const returnable = item.quantityMilli - (item.returnedMilli ?? 0);
    if (line.quantityMilli <= 0) {
      throw new Error("كمية الإرجاع يجب أن تكون أكبر من صفر");
    }
    if (line.quantityMilli > returnable) {
      throw new Error(`كمية الإرجاع تتجاوز المتبقي من الصنف ${item.name}`);
    }
  }

  const debtReducedMinor = split.debtReducedMinor;
  const refundMinor = split.refundMinor;
  if (refundMinor > 0 && !input.refundAccountId) {
    throw new Error("حساب الاسترداد النقدي مطلوب");
  }

  const debt =
    sale.debtId && debtReducedMinor > 0
      ? await db.debts.get(sale.debtId)
      : null;

  const createdAt = nowIso();
  const opId = newId();
  const updatedAt = createdAt;

  const updatedSale: LocalSale = {
    ...sale,
    returnedAmountMinor: (sale.returnedAmountMinor ?? 0) + split.returnMinor,
    updatedAt,
    syncStatus: sale.syncStatus === "synced" ? "pending" : sale.syncStatus,
    version: sale.version + 1
  };

  let updatedDebt = null;
  if (debt) {
    const remainingAfter = debt.remainingAmountMinor - debtReducedMinor;
    updatedDebt = {
      ...debt,
      amountMinor: debt.amountMinor - debtReducedMinor,
      remainingAmountMinor: remainingAfter,
      status:
        remainingAfter <= 0
          ? ("settled" as const)
          : debt.paidAmountMinor > 0
            ? ("partial" as const)
            : ("open" as const),
      updatedAt,
      syncStatus:
        debt.syncStatus === "synced" ? ("pending" as const) : debt.syncStatus,
      version: debt.version + 1
    };
  }

  let refundAccount = null;
  if (refundMinor > 0 && input.refundAccountId) {
    const account = await db.financialAccounts.get(input.refundAccountId);
    if (!account || account.deletedAt || !account.isActive) {
      throw new Error("حساب الاسترداد غير موجود");
    }
    refundAccount = {
      ...account,
      currentBalanceMinor: account.currentBalanceMinor - refundMinor,
      totalWithdrawalsMinor: account.totalWithdrawalsMinor + refundMinor,
      updatedAt,
      version: account.version + 1
    };
  }

  const entryId = newId();
  const entry = {
    id: entryId,
    entryNumber: tempDocNumber(),
    occurredAt: sale.occurredAt,
    description: `مرتجع بيع — ${sale.saleNumber} — ${reason}`,
    sourceType: "reversal" as const,
    sourceId: sale.id,
    status: "posted" as const,
    reversalOfEntryId: null,
    businessId: ctx.businessId,
    updatedAt,
    syncStatus: "pending" as const,
    version: 1,
    deletedAt: null
  };

  type ReturnLine = Omit<LocalJournalEntryLine, never>;

  const entryLines: ReturnLine[] = [];
  let running = 0;
  if (debtReducedMinor > 0) {
    entryLines.push({
      id: newId(),
      businessId: ctx.businessId,
      entryId,
      glCode: "1300",
      debitMinor: 0,
      creditMinor: debtReducedMinor,
      financialAccountId: null,
      partyType: "customer",
      partyId: sale.customerId
    });
    running += debtReducedMinor;
  }
  if (refundMinor > 0 && refundAccount) {
    entryLines.push({
      id: newId(),
      businessId: ctx.businessId,
      entryId,
      glCode: refundAccount.type === "cash" ? "1100" : "1200",
      debitMinor: 0,
      creditMinor: refundMinor,
      financialAccountId: refundAccount.id,
      partyType: null,
      partyId: null
    });
    running += refundMinor;
  }
  const remainder = split.returnMinor - running;
  if (remainder !== 0) {
    entryLines.push({
      id: newId(),
      businessId: ctx.businessId,
      entryId,
      glCode: "5950",
      debitMinor: remainder > 0 ? remainder : 0,
      creditMinor: remainder < 0 ? -remainder : 0,
      financialAccountId: null,
      partyType: null,
      partyId: null
    });
  }
  entryLines.push({
    id: newId(),
    businessId: ctx.businessId,
    entryId,
    glCode: "4100",
    debitMinor: split.returnMinor,
    creditMinor: 0,
    financialAccountId: null,
    partyType: null,
    partyId: null
  });

  await db.transaction(
    "rw",
    [
      db.sales,
      db.saleItems,
      db.products,
      db.inventoryMovements,
      db.debts,
      db.customers,
      db.financialAccounts,
      db.journalEntries,
      db.journalEntryLines,
      db.outbox
    ],
    async () => {
      for (const line of input.lines) {
        const item = await db.saleItems.get(line.saleItemId);
        if (!item) continue;
        await db.saleItems.put({
          ...item,
          returnedMilli: (item.returnedMilli ?? 0) + line.quantityMilli
        });

        if (item.productId) {
          const product = await db.products.get(item.productId);
          if (product && !product.deletedAt && product.businessId === ctx.businessId) {
            await db.products.put({
              ...product,
              quantityMilli: product.quantityMilli + line.quantityMilli,
              updatedAt,
              syncStatus:
                product.syncStatus === "synced"
                  ? ("pending" as const)
                  : product.syncStatus,
              version: product.version + 1
            });
          }
          await db.inventoryMovements.put({
            id: newId(),
            businessId: ctx.businessId,
            productId: item.productId,
            type: "in",
            quantityMilli: line.quantityMilli,
            unitCostMinor: null,
            refType: "sale_return",
            refId: sale.id,
            occurredAt: createdAt,
            notes: `مرتجع بيع — ${reason}`,
            createdBy: ctx.createdBy ?? ""
          });
        }
      }

      if (updatedDebt) {
        await db.debts.put(updatedDebt);
      }
      if (debtReducedMinor > 0 && sale.customerId) {
        const customer = await db.customers.get(sale.customerId);
        if (customer) {
          await db.customers.put({
            ...customer,
            currentBalanceMinor: customer.currentBalanceMinor - debtReducedMinor,
            updatedAt,
            version: customer.version + 1
          });
        }
      }
      if (refundAccount) {
        await db.financialAccounts.put(refundAccount);
      }

      await db.journalEntries.put(entry);
      await db.journalEntryLines.bulkPut(entryLines);
      await db.sales.put(updatedSale);

      await enqueueOp({
        db,
        businessId: ctx.businessId,
        opType: "sale.return",
        entityType: "sales",
        entityId: sale.id,
        payload: {
          clientOpId: opId,
          createdAt,
          opType: "sale.return",
          saleId: sale.id,
          items: input.lines.map((line) => ({
            saleItemId: line.saleItemId,
            quantityMilli: line.quantityMilli
          })),
          reason,
          refundAccountId: refundMinor > 0 ? input.refundAccountId : null
        }
      });
    }
  );

  return {
    sale: updatedSale,
    returnMinor: split.returnMinor,
    debtReducedMinor,
    refundMinor
  };
}
