import type { ChartAccount } from "./types";

export const GL = {
  ASSETS: "1000",
  CASH: "1100",
  BANKS: "1200",
  AR: "1300",
  INVENTORY: "1400",
  LIABILITIES: "2000",
  AP: "2100",
  EQUITY: "3000",
  CAPITAL: "3100",
  REVENUE: "4000",
  SALES: "4100",
  SALES_DISCOUNT: "4900",
  EXPENSES: "5000",
  COGS: "5900",
  RECONCILE_DIFF: "5950"
} as const;

export const GL_ACCOUNTS: ChartAccount[] = [
  { code: "1000", name: "الأصول", type: "asset", parentCode: null, isCash: false },
  { code: "1100", name: "الصندوق النقدي", type: "asset", parentCode: "1000", isCash: true },
  { code: "1200", name: "البنوك والمحافظ", type: "asset", parentCode: "1000", isCash: true },
  { code: "1300", name: "العملاء (مدينون)", type: "asset", parentCode: "1000", isCash: false },
  { code: "1400", name: "المخزون", type: "asset", parentCode: "1000", isCash: false },
  { code: "2000", name: "الالتزامات", type: "liability", parentCode: null, isCash: false },
  { code: "2100", name: "الموردون (دائنون)", type: "liability", parentCode: "2000", isCash: false },
  { code: "3000", name: "حقوق الملكية", type: "equity", parentCode: null, isCash: false },
  { code: "3100", name: "رأس المال الافتتاحي", type: "equity", parentCode: "3000", isCash: false },
  { code: "4000", name: "الإيرادات", type: "revenue", parentCode: null, isCash: false },
  { code: "4100", name: "المبيعات", type: "revenue", parentCode: "4000", isCash: false },
  { code: "4900", name: "خصومات المبيعات", type: "revenue", parentCode: "4000", isCash: false },
  { code: "5000", name: "المصروفات", type: "expense", parentCode: null, isCash: false },
  { code: "5100", name: "إيجار", type: "expense", parentCode: "5000", isCash: false },
  { code: "5110", name: "كهرباء", type: "expense", parentCode: "5000", isCash: false },
  { code: "5120", name: "مياه", type: "expense", parentCode: "5000", isCash: false },
  { code: "5130", name: "أجور ورواتب", type: "expense", parentCode: "5000", isCash: false },
  { code: "5140", name: "مواصلات", type: "expense", parentCode: "5000", isCash: false },
  { code: "5150", name: "صيانة", type: "expense", parentCode: "5000", isCash: false },
  { code: "5160", name: "إنترنت واتصالات", type: "expense", parentCode: "5000", isCash: false },
  { code: "5170", name: "مواد تشغيلية", type: "expense", parentCode: "5000", isCash: false },
  { code: "5180", name: "مصروفات إدارية", type: "expense", parentCode: "5000", isCash: false },
  { code: "5190", name: "مصروفات أخرى", type: "expense", parentCode: "5000", isCash: false },
  { code: "5900", name: "تكلفة المبيعات والمشتريات", type: "expense", parentCode: "5000", isCash: false },
  { code: "5950", name: "فروقات تسوية الحسابات", type: "expense", parentCode: "5000", isCash: false }
];

const byCode = new Map<string, ChartAccount>(
  GL_ACCOUNTS.map((account) => [account.code, account])
);

export class UnknownGLAccountError extends Error {
  constructor(code: string) {
    super(`حساب محاسبي غير معروف: ${code}`);
    this.name = "UnknownGLAccountError";
  }
}

export function getGLAccount(code: string): ChartAccount {
  const account = byCode.get(code);
  if (!account) throw new UnknownGLAccountError(code);
  return account;
}
