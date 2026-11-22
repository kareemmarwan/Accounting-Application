import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/core/supabase/server";
import { getSessionUser } from "@/features/auth/server/session";
import type { SyncPullDelta, SyncPullResponse } from "@/core/validation/sync-payload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pullSchema = z.object({
  businessId: z.string().uuid(),
  deviceId: z.string().min(8).max(64),
  since: z.string().nullable()
});

const PULL_TABLES = [
  "customers",
  "suppliers",
  "financial_accounts",
  "expense_categories",
  "products",
  "sales",
  "sale_items",
  "purchases",
  "expenses",
  "debts",
  "debt_payments",
  "journal_entries",
  "journal_entry_lines"
] as const;

const PAGE_SIZE = 500;

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "انتهت الجلسة — سجّل الدخول" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "لم يتم إعداد Supabase" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "طلب غير صالح" }, { status: 400 });
  }

  const parsed = pullSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "طلب سحب غير صالح" },
      { status: 400 }
    );
  }

  const { businessId, since } = parsed.data;
  const serverTime = new Date().toISOString();
  const deltas: SyncPullDelta[] = [];

  for (const table of PULL_TABLES) {
    let query = supabase
      .from(table)
      .select("*")
      .eq("business_id", businessId)
      .gt("updated_at", since ?? "1970-01-01T00:00:00.000Z")
      .order("updated_at", { ascending: true })
      .limit(PAGE_SIZE);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json(
        { ok: false, error: `تعذر سحب ${table}: ${error.message}` },
        { status: 500 }
      );
    }
    if (data && data.length > 0) {
      deltas.push({ table, rows: data });
    }
  }

  const response: SyncPullResponse = {
    ok: true,
    serverTime,
    watermark: serverTime,
    deltas
  };
  return NextResponse.json(response);
}
