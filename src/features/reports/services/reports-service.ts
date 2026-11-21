import { getDB, type LocalDebtPayment, type LocalExpense, type LocalExpenseCategory, type LocalFinancialAccount, type LocalParty, type LocalPurchase, type LocalSale } from "@/core/db/db";

export type ReportKind =
  | "sales"
  | "purchases"
  | "expenses"
  | "pl"
  | "cashflow"
  | "customer_debts"
  | "supplier_dues"
  | "account_balances"
  | "daily_performance"
  | "monthly_performance";

export const REPORT_LABELS: Record<ReportKind, string> = {
  sales: "تقرير المبيعات",
  purchases: "تقرير المشتريات",
  expenses: "تقرير المصروفات",
  pl: "الأرباح والخسائر",
  cashflow: "التدفقات النقدية",
  customer_debts: "ديون العملاء",
  supplier_dues: "مستحقات الموردين",
  account_balances: "أرصدة الحسابات المالية",
  daily_performance: "الأداء اليومي",
  monthly_performance: "الأداء الشهري"
};

export interface ReportRange {
  fromIso: string;
  toIso: string;
}

export function defaultRange(): ReportRange {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    fromIso: first.toISOString(),
    toIso: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString()
  };
}

export interface ReportRow {
  cells: string[];
}

export interface ReportTable {
  columns: string[];
  rows: ReportRow[];
  totals: string[] | null;
  note?: string;
}

export interface SalesReportDetail {
  sale: LocalSale;
  customerName: string | null;
}

export interface ReportsBundle {
  tables: Record<ReportKind, ReportTable>;
  details: {
    sales: SalesReportDetail[];
    purchases: Array<{ purchase: LocalPurchase; supplierName: string | null }>;
    expenses: Array<{ expense: LocalExpense; categoryName: string }>;
    payments: Array<{ payment: LocalDebtPayment; direction: string; partyName: string }>;
    salesRows: LocalSale[];
    purchasesRows: LocalPurchase[];
    expensesRows: LocalExpense[];
    paymentsRows: LocalDebtPayment[];
    customers: LocalParty[];
    suppliers: LocalParty[];
    accounts: LocalFinancialAccount[];
    categories: LocalExpenseCategory[];
  };
}

function money(minor: number): string {
  return (minor / 100).toFixed(2);
}

function dateOnly(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ar-PS", { dateStyle: "short" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function sum(list: number[]): number {
  return list.reduce((total, value) => total + value, 0);
}

export async function buildReports(
  range: ReportRange,
  db = getDB()
): Promise<ReportsBundle> {
  const { fromIso, toIso } = range;
  const inRange = (iso: string) => iso >= fromIso && iso <= toIso;

  const [salesAll, purchasesAll, expensesAll, paymentsAll, customers, suppliers, accounts, categories, debtsAll] =
    await Promise.all([
      db.sales.toArray(),
      db.purchases.toArray(),
      db.expenses.toArray(),
      db.debtPayments.toArray(),
      db.customers.toArray(),
      db.suppliers.toArray(),
      db.financialAccounts.toArray(),
      db.expenseCategories.toArray(),
      db.debts.toArray()
    ]);

  const sales = salesAll.filter((sale) => !sale.deletedAt && sale.status !== "void" && inRange(sale.occurredAt));
  const purchases = purchasesAll.filter(
    (purchase) => !purchase.deletedAt && purchase.status !== "void" && inRange(purchase.occurredAt)
  );
  const expenses = expensesAll.filter(
    (expense) => !expense.deletedAt && expense.status !== "void" && inRange(expense.occurredAt)
  );
  const payments = paymentsAll.filter((payment) => !payment.deletedAt && inRange(payment.occurredAt));

  const customerNameById = new Map(customers.map((party) => [party.id, party.name]));
  const supplierNameById = new Map(suppliers.map((party) => [party.id, party.name]));
  const categoryNameById = new Map(categories.map((category) => [category.id, category.name]));

  const salesRows = [...sales].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  const purchasesRows = [...purchases].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  const expensesRows = [...expenses].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  const paymentsRows = [...payments].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));

  const tables: Record<ReportKind, ReportTable> = {
    sales: {
      columns: ["التاريخ", "رقم الفاتورة", "العميل", "الإجمالي", "الخصم", "الصافي", "المدفوع", "المتبقي"],
      rows: salesRows.map((sale) => ({
        cells: [
          dateOnly(sale.occurredAt),
          sale.saleNumber,
          sale.customerId ? customerNameById.get(sale.customerId) ?? "—" : "نقدي",
          money(sale.totalAmountMinor),
          money(sale.discountMinor),
          money(sale.netAmountMinor),
          money(sale.paidAmountMinor),
          money(sale.remainingAmountMinor)
        ]
      })),
      totals: [
        "الإجمالي",
        "",
        "",
        money(sum(salesRows.map((sale) => sale.totalAmountMinor))),
        money(sum(salesRows.map((sale) => sale.discountMinor))),
        money(sum(salesRows.map((sale) => sale.netAmountMinor))),
        money(sum(salesRows.map((sale) => sale.paidAmountMinor))),
        money(sum(salesRows.map((sale) => sale.remainingAmountMinor)))
      ]
    },
    purchases: {
      columns: ["التاريخ", "رقم الفاتورة", "المورد", "الإجمالي", "الخصم", "الصافي", "المدفوع", "المتبقي"],
      rows: purchasesRows.map((purchase) => ({
        cells: [
          dateOnly(purchase.occurredAt),
          purchase.purchaseNumber,
          purchase.supplierId ? supplierNameById.get(purchase.supplierId) ?? "—" : "نقدي",
          money(purchase.totalAmountMinor),
          money(purchase.discountMinor),
          money(purchase.netAmountMinor),
          money(purchase.paidAmountMinor),
          money(purchase.remainingAmountMinor)
        ]
      })),
      totals: [
        "الإجمالي",
        "",
        "",
        money(sum(purchasesRows.map((purchase) => purchase.totalAmountMinor))),
        money(sum(purchasesRows.map((purchase) => purchase.discountMinor))),
        money(sum(purchasesRows.map((purchase) => purchase.netAmountMinor))),
        money(sum(purchasesRows.map((purchase) => purchase.paidAmountMinor))),
        money(sum(purchasesRows.map((purchase) => purchase.remainingAmountMinor)))
      ]
    },
    expenses: {
      columns: ["التاريخ", "البيان", "التصنيف", "طريقة الدفع", "المبلغ"],
      rows: expensesRows.map((expense) => ({
        cells: [
          dateOnly(expense.occurredAt),
          expense.title,
          categoryNameById.get(expense.categoryId) ?? "—",
          expense.paymentMethod,
          money(expense.amountMinor)
        ]
      })),
      totals: [
        "الإجمالي",
        "",
        "",
        "",
        money(sum(expensesRows.map((expense) => expense.amountMinor)))
      ]
    },
    pl: (() => {
      const revenue = sum(salesRows.map((sale) => sale.netAmountMinor));
      const cogs = sum(purchasesRows.map((purchase) => purchase.netAmountMinor));
      const opex = sum(expensesRows.map((expense) => expense.amountMinor));
      const gross = revenue - cogs;
      const net = gross - opex;
      return {
        columns: ["البند", "المبلغ (₪)"],
        rows: [
          { cells: ["إيرادات المبيعات (استحقاق)", money(revenue)] },
          { cells: ["تكلفة المشتريات المباعة", `(${money(cogs)})`] },
          { cells: ["مجمل الربح (تقديري)", money(gross)] },
          { cells: ["المصروفات التشغيلية", `(${money(opex)})`] },
          { cells: ["صافي الربح (تقديري)", money(net)] }
        ],
        totals: null,
        note:
          "الأساس استحقاقي مع تكلفة مُقدَّرة: تُحتسب تكلفة البضاعة كإجمالي مشتريات الفترة (بلا مخزون). للأرباح الدقيقة فعلّق المخزون."
      };
    })(),
    cashflow: (() => {
      const columns = ["الحساب المالي", "متحصلات", "مدفوعات", "الصافي"];
      const perAccount = new Map<string, { inflow: number; outflow: number }>();
      const add = (accountId: string | null, amount: number, inflow: boolean) => {
        if (!accountId) return;
        const current = perAccount.get(accountId) ?? { inflow: 0, outflow: 0 };
        if (inflow) current.inflow += amount;
        else current.outflow += amount;
        perAccount.set(accountId, current);
      };
      for (const sale of salesRows) {
        if (sale.paymentMethod !== "credit") add(sale.accountId, sale.paidAmountMinor, true);
      }
      for (const purchase of purchasesRows) {
        if (purchase.paymentMethod !== "credit") add(purchase.accountId, purchase.paidAmountMinor, false);
      }
      for (const expense of expensesRows) add(expense.accountId, expense.amountMinor, false);
      for (const payment of paymentsRows) {
        const debt = debtsAll.find((candidate) => candidate.id === payment.debtId);
        add(payment.accountId, payment.amountMinor, debt?.direction === "receivable");
      }
      const rows = accounts
        .filter((account) => !account.deletedAt && perAccount.has(account.id))
        .map((account) => {
          const value = perAccount.get(account.id) ?? { inflow: 0, outflow: 0 };
          return {
            cells: [
              account.name,
              money(value.inflow),
              money(value.outflow),
              money(value.inflow - value.outflow)
            ]
          };
        });
      const totalInflow = sum(Array.from(perAccount.values()).map((value) => value.inflow));
      const totalOutflow = sum(Array.from(perAccount.values()).map((value) => value.outflow));
      return {
        columns,
        rows,
        totals: [
          "الإجمالي",
          money(totalInflow),
          money(totalOutflow),
          money(totalInflow - totalOutflow)
        ],
        note: "الأساس نقدي — الدفعات وحدها تحرك النقدية؛ لا تشمل تسويات الأرصدة."
      };
    })(),
    customer_debts: (() => {
      const receivableDebts = debtsAll.filter(
        (debt) => !debt.deletedAt && debt.direction === "receivable" && debt.remainingAmountMinor > 0
      );
      const perCustomer = new Map<string, number>();
      for (const debt of receivableDebts) {
        perCustomer.set(debt.partyId, (perCustomer.get(debt.partyId) ?? 0) + debt.remainingAmountMinor);
      }
      const rows = Array.from(perCustomer.entries())
        .map(([partyId, remaining]) => ({
          cells: [
            customerNameById.get(partyId) ?? "—",
            customers.find((party) => party.id === partyId)?.phone ?? "",
            money(remaining)
          ]
        }))
        .sort((a, b) => Number(b.cells[2]) - Number(a.cells[2]));
      return {
        columns: ["العميل", "الهاتف", "المتبقي عليه"],
        rows,
        totals: ["الإجمالي", "", money(sum(Array.from(perCustomer.values())))]
      };
    })(),
    supplier_dues: (() => {
      const payableDebts = debtsAll.filter(
        (debt) => !debt.deletedAt && debt.direction === "payable" && debt.remainingAmountMinor > 0
      );
      const perSupplier = new Map<string, number>();
      for (const debt of payableDebts) {
        perSupplier.set(debt.partyId, (perSupplier.get(debt.partyId) ?? 0) + debt.remainingAmountMinor);
      }
      const rows = Array.from(perSupplier.entries())
        .map(([partyId, remaining]) => ({
          cells: [
            supplierNameById.get(partyId) ?? "—",
            suppliers.find((party) => party.id === partyId)?.phone ?? "",
            money(remaining)
          ]
        }))
        .sort((a, b) => Number(b.cells[2]) - Number(a.cells[2]));
      return {
        columns: ["المورد", "الهاتف", "المتبقي لنا دفعه"],
        rows,
        totals: ["الإجمالي", "", money(sum(Array.from(perSupplier.values())))]
      };
    })(),
    account_balances: {
      columns: ["الحساب", "النوع", "المزود", "افتتاحي", "إيداعات", "سحوبات", "الرصيد الحالي"],
      rows: accounts
        .filter((account) => !account.deletedAt)
        .sort((a, b) => (a.type === "cash" ? -1 : 1) - (b.type === "cash" ? -1 : 1))
        .map((account) => ({
          cells: [
            account.name,
            account.type === "cash" ? "نقدي" : account.type === "bank" ? "بنك" : "محفظة/أخرى",
            account.provider ?? "—",
            money(account.openingBalanceMinor),
            money(account.totalDepositsMinor),
            money(account.totalWithdrawalsMinor),
            money(account.currentBalanceMinor)
          ]
        })),
      totals: [
        "الإجمالي",
        "",
        "",
        money(sum(accounts.filter((account) => !account.deletedAt).map((account) => account.openingBalanceMinor))),
        money(sum(accounts.filter((account) => !account.deletedAt).map((account) => account.totalDepositsMinor))),
        money(sum(accounts.filter((account) => !account.deletedAt).map((account) => account.totalWithdrawalsMinor))),
        money(sum(accounts.filter((account) => !account.deletedAt).map((account) => account.currentBalanceMinor)))
      ]
    },
    daily_performance: (() => {
      const byDay = new Map<string, { sales: number; purchases: number; expenses: number }>();
      const ensure = (iso: string) => {
        const key = iso.slice(0, 10);
        const current = byDay.get(key) ?? { sales: 0, purchases: 0, expenses: 0 };
        byDay.set(key, current);
        return key;
      };
      for (const sale of salesRows) {
        const key = ensure(sale.occurredAt);
        byDay.get(key)!.sales += sale.netAmountMinor;
      }
      for (const purchase of purchasesRows) {
        const key = ensure(purchase.occurredAt);
        byDay.get(key)!.purchases += purchase.netAmountMinor;
      }
      for (const expense of expensesRows) {
        const key = ensure(expense.occurredAt);
        byDay.get(key)!.expenses += expense.amountMinor;
      }
      const rows = Array.from(byDay.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, value]) => ({
          cells: [
            dateOnly(`${key}T12:00:00.000Z`),
            money(value.sales),
            money(value.purchases),
            money(value.expenses),
            money(value.sales - value.purchases - value.expenses)
          ]
        }));
      return {
        columns: ["اليوم", "مبيعات", "مشتريات", "مصروفات", "نتيجة تقديرية"],
        rows,
        totals: [
          "الإجمالي",
          money(sum(salesRows.map((sale) => sale.netAmountMinor))),
          money(sum(purchasesRows.map((purchase) => purchase.netAmountMinor))),
          money(sum(expensesRows.map((expense) => expense.amountMinor))),
          money(
            sum(salesRows.map((sale) => sale.netAmountMinor)) -
              sum(purchasesRows.map((purchase) => purchase.netAmountMinor)) -
              sum(expensesRows.map((expense) => expense.amountMinor))
          )
        ]
      };
    })(),
    monthly_performance: (() => {
      const byMonth = new Map<string, { sales: number; purchases: number; expenses: number }>();
      const keyOf = (iso: string) => iso.slice(0, 7);
      for (const sale of salesRows) {
        const key = keyOf(sale.occurredAt);
        const current = byMonth.get(key) ?? { sales: 0, purchases: 0, expenses: 0 };
        current.sales += sale.netAmountMinor;
        byMonth.set(key, current);
      }
      for (const purchase of purchasesRows) {
        const key = keyOf(purchase.occurredAt);
        const current = byMonth.get(key) ?? { sales: 0, purchases: 0, expenses: 0 };
        current.purchases += purchase.netAmountMinor;
        byMonth.set(key, current);
      }
      for (const expense of expensesRows) {
        const key = keyOf(expense.occurredAt);
        const current = byMonth.get(key) ?? { sales: 0, purchases: 0, expenses: 0 };
        current.expenses += expense.amountMinor;
        byMonth.set(key, current);
      }
      const rows = Array.from(byMonth.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, value]) => ({
          cells: [
            key,
            money(value.sales),
            money(value.purchases),
            money(value.expenses),
            money(value.sales - value.purchases - value.expenses)
          ]
        }));
      return {
        columns: ["الشهر", "مبيعات", "مشتريات", "مصروفات", "نتيجة تقديرية"],
        rows,
        totals: [
          "الإجمالي",
          money(sum(salesRows.map((sale) => sale.netAmountMinor))),
          money(sum(purchasesRows.map((purchase) => purchase.netAmountMinor))),
          money(sum(expensesRows.map((expense) => expense.amountMinor))),
          money(
            sum(salesRows.map((sale) => sale.netAmountMinor)) -
              sum(purchasesRows.map((purchase) => purchase.netAmountMinor)) -
              sum(expensesRows.map((expense) => expense.amountMinor))
          )
        ]
      };
    })()
  };

  return {
    tables,
    details: {
      sales: salesRows.map((sale) => ({
        sale,
        customerName: sale.customerId ? customerNameById.get(sale.customerId) ?? null : null
      })),
      purchases: purchasesRows.map((purchase) => ({
        purchase,
        supplierName: purchase.supplierId ? supplierNameById.get(purchase.supplierId) ?? null : null
      })),
      expenses: expensesRows.map((expense) => ({
        expense,
        categoryName: categoryNameById.get(expense.categoryId) ?? "—"
      })),
      payments: paymentsRows.map((payment) => {
        const debt = debtsAll.find((candidate) => candidate.id === payment.debtId);
        return {
          payment,
          direction: debt?.direction === "payable" ? "سداد مورد" : "تحصيل عميل",
          partyName:
            debt?.direction === "payable"
              ? supplierNameById.get(debt?.partyId ?? "") ?? "—"
              : customerNameById.get(debt?.partyId ?? "") ?? "—"
        };
      }),
      salesRows,
      purchasesRows,
      expensesRows,
      paymentsRows,
      customers,
      suppliers,
      accounts,
      categories
    }
  };
}

export function buildCsv(columns: string[], rows: ReportRow[], totals: string[] | null): string {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const lines = [columns.map(escape).join(",")];
  for (const row of rows) {
    lines.push(row.cells.map(escape).join(","));
  }
  if (totals) {
    lines.push(totals.map(escape).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}`;
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
