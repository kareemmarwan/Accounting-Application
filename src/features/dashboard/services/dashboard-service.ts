import { getDB, type LocalDebtPayment, type LocalExpense, type LocalPurchase, type LocalSale } from "@/core/db/db";
import type { CashPaymentMethod } from "@/core/accounting/types";

export type DashboardPeriod = "today" | "week" | "month" | "year";

export const PERIOD_LABELS: Record<DashboardPeriod, string> = {
  today: "اليوم",
  week: "هذا الأسبوع",
  month: "هذا الشهر",
  year: "هذه السنة"
};

export interface DashboardCards {
  sales: number;
  purchases: number;
  expenses: number;
  estimatedProfit: number;
  salesCount: number;
}

export interface DashboardBalances {
  customerDebts: number;
  supplierDues: number;
  cash: number;
  banks: number;
  total: number;
}

export interface DashboardActivity {
  id: string;
  kind: "sale" | "purchase" | "expense" | "payment";
  title: string;
  amountMinor: number;
  occurredAt: string;
}

export interface DailySeriesPoint {
  date: string;
  sales: number;
  purchases: number;
  expenses: number;
}

export interface MonthlySeriesPoint {
  month: string;
  sales: number;
  purchases: number;
  expenses: number;
}

export interface ExpenseCategoryPoint {
  name: string;
  value: number;
}

export interface PaymentMethodPoint {
  name: string;
  value: number;
}

export interface DashboardData {
  cards: DashboardCards;
  balances: DashboardBalances;
  activity: DashboardActivity[];
  daily: DailySeriesPoint[];
  monthly: MonthlySeriesPoint[];
  expenseByCategory: ExpenseCategoryPoint[];
  paymentMethods: PaymentMethodPoint[];
  period: DashboardPeriod;
}

function periodStart(period: DashboardPeriod): Date {
  const now = new Date();
  if (period === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  if (period === "week") {
    const day = (now.getDay() + 6) % 7;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
    return monday;
  }
  if (period === "month") {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return new Date(now.getFullYear(), 0, 1);
}

function dayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const MONTH_NAMES = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر"
];

const PAYMENT_LABELS: Record<CashPaymentMethod, string> = {
  cash: "نقداً",
  bank_transfer: "تحويل بنكي",
  palpay: "PalPay",
  jawwal_pay: "Jawwal Pay",
  electronic: "إلكتروني"
};

export async function loadDashboardData(
  period: DashboardPeriod,
  db = getDB()
): Promise<DashboardData> {
  const start = periodStart(period);
  const startIso = start.toISOString();

  const sales = (await db.sales.toArray()).filter(
    (sale) => !sale.deletedAt && sale.status !== "void"
  );
  const purchases = (await db.purchases.toArray()).filter(
    (purchase) => !purchase.deletedAt && purchase.status !== "void"
  );
  const expenses = (await db.expenses.toArray()).filter(
    (expense) => !expense.deletedAt && expense.status !== "void"
  );
  const accounts = (await db.financialAccounts.toArray()).filter(
    (account) => account.isActive && !account.deletedAt
  );
  const partiesCustomers = (await db.customers.toArray()).filter(
    (party) => !party.deletedAt
  );
  const partiesSuppliers = (await db.suppliers.toArray()).filter(
    (party) => !party.deletedAt
  );
  const categories = await db.expenseCategories.toArray();

  const periodSales = sales.filter((sale) => sale.occurredAt >= startIso);
  const periodPurchases = purchases.filter((purchase) => purchase.occurredAt >= startIso);
  const periodExpenses = expenses.filter((expense) => expense.occurredAt >= startIso);

  const salesSum = periodSales.reduce((sum, sale) => sum + sale.netAmountMinor, 0);
  const purchasesSum = periodPurchases.reduce((sum, purchase) => sum + purchase.netAmountMinor, 0);
  const expensesSum = periodExpenses.reduce((sum, expense) => sum + expense.amountMinor, 0);

  const cards: DashboardCards = {
    sales: salesSum,
    purchases: purchasesSum,
    expenses: expensesSum,
    estimatedProfit: salesSum - purchasesSum - expensesSum,
    salesCount: periodSales.length
  };

  const cash = accounts
    .filter((account) => account.type === "cash")
    .reduce((sum, account) => sum + account.currentBalanceMinor, 0);
  const banks = accounts
    .filter((account) => account.type !== "cash")
    .reduce((sum, account) => sum + account.currentBalanceMinor, 0);

  const customerDebts = partiesCustomers.reduce(
    (sum, party) => sum + Math.max(party.currentBalanceMinor, 0),
    0
  );
  const supplierDues = partiesSuppliers.reduce(
    (sum, party) => sum + Math.max(party.currentBalanceMinor, 0),
    0
  );

  const balances: DashboardBalances = {
    customerDebts,
    supplierDues,
    cash,
    banks,
    total: cash + banks
  };

  const payments = (await db.debtPayments.toArray()).filter(
    (payment) => !payment.deletedAt
  );

  const activity: DashboardActivity[] = [
    ...periodSales.slice(-12).map<DashboardActivity>((sale) => ({
      id: `sale-${sale.id}`,
      kind: "sale",
      title: `بيع ${sale.saleNumber}${sale.description ? ` — ${sale.description}` : ""}`,
      amountMinor: sale.netAmountMinor,
      occurredAt: sale.occurredAt
    })),
    ...periodPurchases.slice(-12).map<DashboardActivity>((purchase) => ({
      id: `purchase-${purchase.id}`,
      kind: "purchase",
      title: `شراء ${purchase.purchaseNumber}${purchase.description ? ` — ${purchase.description}` : ""}`,
      amountMinor: purchase.netAmountMinor,
      occurredAt: purchase.occurredAt
    })),
    ...periodExpenses.slice(-12).map<DashboardActivity>((expense) => ({
      id: `expense-${expense.id}`,
      kind: "expense",
      title: `مصروف — ${expense.title}`,
      amountMinor: expense.amountMinor,
      occurredAt: expense.occurredAt
    })),
    ...payments
      .filter((payment) => payment.occurredAt >= startIso)
      .slice(-12)
      .map<DashboardActivity>((payment) => ({
        id: `payment-${payment.id}`,
        kind: "payment",
        title: "دفعة ديون",
        amountMinor: payment.amountMinor,
        occurredAt: payment.occurredAt
      }))
  ]
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
    .slice(0, 10);

  const daily: DailySeriesPoint[] = [];
  const salesByDay = new Map<string, number>();
  const purchasesByDay = new Map<string, number>();
  const expensesByDay = new Map<string, number>();
  for (let index = 29; index >= 0; index -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - index);
    const key = dayKey(date);
    daily.push({ date: key, sales: 0, purchases: 0, expenses: 0 });
    salesByDay.set(key, 0);
    purchasesByDay.set(key, 0);
    expensesByDay.set(key, 0);
  }
  for (const sale of sales) {
    const key = dayKey(new Date(sale.occurredAt));
    const current = salesByDay.get(key);
    if (current !== undefined) {
      salesByDay.set(key, current + sale.netAmountMinor);
    }
  }
  for (const purchase of purchases) {
    const key = dayKey(new Date(purchase.occurredAt));
    const current = purchasesByDay.get(key);
    if (current !== undefined) {
      purchasesByDay.set(key, current + purchase.netAmountMinor);
    }
  }
  for (const expense of expenses) {
    const key = dayKey(new Date(expense.occurredAt));
    const current = expensesByDay.get(key);
    if (current !== undefined) {
      expensesByDay.set(key, current + expense.amountMinor);
    }
  }
  for (const point of daily) {
    point.sales = salesByDay.get(point.date) ?? 0;
    point.purchases = purchasesByDay.get(point.date) ?? 0;
    point.expenses = expensesByDay.get(point.date) ?? 0;
  }

  const monthly: MonthlySeriesPoint[] = [];
  const now = new Date();
  const monthlySales = new Map<string, number>();
  const monthlyPurchases = new Map<string, number>();
  const monthlyExpenses = new Map<string, number>();
  for (let index = 5; index >= 0; index -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    monthly.push({
      month: MONTH_NAMES[date.getMonth()] ?? "شهر",
      sales: 0,
      purchases: 0,
      expenses: 0
    });
    monthlySales.set(key, 0);
    monthlyPurchases.set(key, 0);
    monthlyExpenses.set(key, 0);
  }
  const monthKeyOf = (iso: string) => {
    const date = new Date(iso);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  };
  for (const sale of sales) {
    const key = monthKeyOf(sale.occurredAt);
    const current = monthlySales.get(key);
    if (current !== undefined) monthlySales.set(key, current + sale.netAmountMinor);
  }
  for (const purchase of purchases) {
    const key = monthKeyOf(purchase.occurredAt);
    const current = monthlyPurchases.get(key);
    if (current !== undefined) monthlyPurchases.set(key, current + purchase.netAmountMinor);
  }
  for (const expense of expenses) {
    const key = monthKeyOf(expense.occurredAt);
    const current = monthlyExpenses.get(key);
    if (current !== undefined) monthlyExpenses.set(key, current + expense.amountMinor);
  }
  for (const point of monthly) {
    const monthIndex = MONTH_NAMES.indexOf(point.month);
    const key = `${now.getFullYear()}-${String(monthIndex >= 0 ? monthIndex + 1 : 1).padStart(2, "0")}`;
    point.sales = monthlySales.get(key) ?? 0;
    point.purchases = monthlyPurchases.get(key) ?? 0;
    point.expenses = monthlyExpenses.get(key) ?? 0;
  }

  const categoryTotals = new Map<string, number>();
  for (const expense of periodExpenses) {
    const current = categoryTotals.get(expense.categoryId) ?? 0;
    categoryTotals.set(expense.categoryId, current + expense.amountMinor);
  }
  const categoryNameById = new Map(categories.map((category) => [category.id, category.name]));
  const expenseByCategory: ExpenseCategoryPoint[] = Array.from(categoryTotals.entries())
    .map(([categoryId, value]) => ({
      name: categoryNameById.get(categoryId) ?? "تصنيف",
      value
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const methodTotals = new Map<CashPaymentMethod, number>();
  for (const sale of periodSales) {
    if (sale.paidAmountMinor > 0 && sale.paymentMethod !== "credit") {
      const current = methodTotals.get(sale.paymentMethod as CashPaymentMethod) ?? 0;
      methodTotals.set(
        sale.paymentMethod as CashPaymentMethod,
        current + sale.paidAmountMinor
      );
    }
  }
  const paymentMethods: PaymentMethodPoint[] = Array.from(methodTotals.entries()).map(
    ([method, value]) => ({ name: PAYMENT_LABELS[method] ?? method, value })
  );

  return {
    cards,
    balances,
    activity,
    daily,
    monthly,
    expenseByCategory,
    paymentMethods,
    period
  };
}

export interface DashboardRefs {
  sales: LocalSale[];
  purchases: LocalPurchase[];
  expenses: LocalExpense[];
  payments: LocalDebtPayment[];
}

export async function loadExportRefs(db = getDB()): Promise<DashboardRefs> {
  const [sales, purchases, expenses, payments] = await Promise.all([
    db.sales.toArray(),
    db.purchases.toArray(),
    db.expenses.toArray(),
    db.debtPayments.toArray()
  ]);
  return {
    sales: sales.filter((row) => !row.deletedAt && row.status !== "void"),
    purchases: purchases.filter((row) => !row.deletedAt && row.status !== "void"),
    expenses: expenses.filter((row) => !row.deletedAt && row.status !== "void"),
    payments: payments.filter((row) => !row.deletedAt)
  };
}
