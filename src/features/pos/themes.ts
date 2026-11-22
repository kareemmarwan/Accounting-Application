import type { LucideIcon } from "lucide-react";
import {
  Apple,
  CircuitBoard,
  CookingPot,
  Pill,
  Shirt,
  ShoppingCart,
  Store,
  Utensils
} from "lucide-react";
import type { ProductUnit } from "@/core/db/db";

export type PosLayout = "grid" | "list";

export interface PosTheme {
  type: string;
  label: string;
  icon: LucideIcon;
  layout: PosLayout;
  scanFirst: boolean;
  weightMode: boolean;
  requireCustomer: boolean;
  lineNoteLabel: string | null;
  scanPlaceholder: string;
  headerClass: string;
  tileClass: string;
  accentChipClass: string;
  hint: string;
}

const BASE_TILE =
  "relative flex flex-col gap-1 rounded-2xl border border-border bg-surface p-3 text-start shadow-sm transition-colors hover:border-primary/60 hover:bg-primary-50/40";

const DEFAULT_THEME: PosTheme = {
  type: "other",
  label: "كاشير عام",
  icon: Store,
  layout: "grid",
  scanFirst: true,
  weightMode: false,
  requireCustomer: false,
  lineNoteLabel: null,
  scanPlaceholder: "امسح الباركود أو أدخله ثم Enter",
  headerClass: "bg-primary text-primary-foreground",
  tileClass: BASE_TILE,
  accentChipClass: "bg-primary-50 text-primary-700",
  hint: "امسح باركود المنتج أو اختره من القائمة — تُحفظ الفاتورة على جهازك فوراً وتُزامَن تلقائياً"
};

const THEMES: Record<string, PosTheme> = {
  grocery: {
    ...DEFAULT_THEME,
    type: "grocery",
    label: "كاشير السوبرماركت",
    icon: ShoppingCart,
    scanPlaceholder: "امسح باركود السلعة — الشريط الأبيض أسفل الماسح",
    accentChipClass: "bg-emerald-50 text-emerald-700",
    tileClass: `${BASE_TILE} hover:border-emerald-500/50 hover:bg-emerald-50/40`,
    hint: "وضع السوبرماركت: مسح سريع متتابع — كل مسح يضيف قطعة واحدة للسلة"
  },
  pharmacy: {
    ...DEFAULT_THEME,
    type: "pharmacy",
    label: "كاشير الصيدلية",
    icon: Pill,
    layout: "list",
    scanPlaceholder: "امسح باركود الدواء أو ابحث بالاسم",
    headerClass: "bg-sky-700 text-white",
    accentChipClass: "bg-sky-50 text-sky-700",
    tileClass: `${BASE_TILE} hover:border-sky-500/50 hover:bg-sky-50/40`,
    hint: "وضع الصيدلية: قائمة بالأدوية مع البحث بالاسم والتصنيف — تفحّص النبضات والكمية قبل الإضافة"
  },
  produce: {
    ...DEFAULT_THEME,
    type: "produce",
    label: "كاشير الخضار والفواكه",
    icon: Apple,
    weightMode: true,
    scanPlaceholder: "امسح باركود الصنف ثم أدخل الوزن بالميزان",
    headerClass: "bg-lime-700 text-white",
    accentChipClass: "bg-lime-50 text-lime-700",
    tileClass: `${BASE_TILE} hover:border-lime-500/50 hover:bg-lime-50/40`,
    hint: "وضع الخضار والفواكه: أدخل الوزن بالكيلوغرام (حتى 3 خانات عشرية) للسلة"
  },
  electronics: {
    ...DEFAULT_THEME,
    type: "electronics",
    label: "كاشير الإلكترونيات",
    icon: CircuitBoard,
    scanFirst: false,
    requireCustomer: true,
    lineNoteLabel: "سيريال/ضمان",
    scanPlaceholder: "امسح باركود الجهاز أو ابحث",
    headerClass: "bg-indigo-700 text-white",
    accentChipClass: "bg-indigo-50 text-indigo-700",
    tileClass: `${BASE_TILE} hover:border-indigo-500/50 hover:bg-indigo-50/40`,
    hint: "وضع الإلكترونيات: فاتورة تفصيلية مع بيانات العميل وسيريال/ضمان لكل جهاز"
  },
  restaurant: {
    ...DEFAULT_THEME,
    type: "restaurant",
    label: "كاشير المطعم",
    icon: Utensils,
    scanFirst: false,
    scanPlaceholder: "اختر من قائمة الطعام",
    headerClass: "bg-orange-600 text-white",
    accentChipClass: "bg-orange-50 text-orange-700",
    tileClass: `${BASE_TILE} hover:border-orange-500/50 hover:bg-orange-50/40`,
    hint: "وضع المطعم: اختر الأصناف من قائمة الطعام — الكاشير السريع للطلبات"
  },
  clothing: {
    ...DEFAULT_THEME,
    type: "clothing",
    label: "كاشير الملابس",
    icon: Shirt,
    scanFirst: false,
    lineNoteLabel: "مقاس/لون",
    scanPlaceholder: "امسح باركود القطعة أو ابحث",
    headerClass: "bg-rose-700 text-white",
    accentChipClass: "bg-rose-50 text-rose-700",
    tileClass: `${BASE_TILE} hover:border-rose-500/50 hover:bg-rose-50/40`,
    hint: "وضع الملابس: سجّل المقاس واللون لكل قطعة قبل الإضافة"
  },
  food: {
    ...DEFAULT_THEME,
    type: "food",
    label: "كاشير المواد الغذائية",
    icon: CookingPot,
    scanPlaceholder: "امسح باركود السلعة أو ابحث بالاسم",
    accentChipClass: "bg-amber-50 text-amber-700",
    tileClass: `${BASE_TILE} hover:border-amber-500/50 hover:bg-amber-50/40`,
    hint: "وضع المواد الغذائية: مسح سريع بالباركود أو البحث بالاسم"
  }
};

export function posThemeFor(businessType: string): PosTheme {
  return THEMES[businessType] ?? DEFAULT_THEME;
}

export function isWeightUnit(unit: ProductUnit): boolean {
  return unit === "kg" || unit === "liter";
}
