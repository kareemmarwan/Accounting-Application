import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/core/supabase/server";
import { getSessionUser } from "@/features/auth/server/session";
import {
  SYNC_OP_TYPES,
  entitySoftDeletePayloadSchema,
  entityUpsertPayloadSchema,
  salePayloadSchema,
  saleAddItemsPayloadSchema,
  saleReturnPayloadSchema,
  purchasePayloadSchema,
  expensePayloadSchema,
  debtPaymentPayloadSchema,
  manualDebtPayloadSchema,
  transferPayloadSchema,
  depositPayloadSchema,
  withdrawalPayloadSchema,
  adjustmentPayloadSchema,
  productUpsertPayloadSchema,
  productSoftDeletePayloadSchema,
  inventoryAdjustPayloadSchema,
  syncPushRequestSchema,
  type SyncPushOpResult,
  type SyncPushResponse,
  type SyncOpType
} from "@/core/validation/sync-payload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bidSchema = z.string().uuid();

function validatePayload(
  opType: string,
  payload: unknown
): { ok: true } | { ok: false; error: string } {
  try {
    switch (opType) {
      case "sale.create":
        return salePayloadSchema.safeParse(payload).success ? { ok: true } : { ok: false, error: "حمولة البيع غير صالحة" };
      case "sale.add_items":
        return saleAddItemsPayloadSchema.safeParse(payload).success ? { ok: true } : { ok: false, error: "حمولة إضافة أصناف غير صالحة" };
      case "sale.return":
        return saleReturnPayloadSchema.safeParse(payload).success ? { ok: true } : { ok: false, error: "حمولة الإرجاع غير صالحة" };
      case "purchase.create":
        return purchasePayloadSchema.safeParse(payload).success ? { ok: true } : { ok: false, error: "حمولة الشراء غير صالحة" };
      case "expense.create":
        return expensePayloadSchema.safeParse(payload).success ? { ok: true } : { ok: false, error: "حمولة المصروف غير صالحة" };
      case "debt_payment.create":
        return debtPaymentPayloadSchema.safeParse(payload).success ? { ok: true } : { ok: false, error: "حمولة الدفعة غير صالحة" };
      case "manual_debt.create":
        return manualDebtPayloadSchema.safeParse(payload).success ? { ok: true } : { ok: false, error: "حمولة الدين اليدوي غير صالحة" };
      case "transfer.create":
        return transferPayloadSchema.safeParse(payload).success ? { ok: true } : { ok: false, error: "حمولة التحويل غير صالحة" };
      case "deposit.create":
        return depositPayloadSchema.safeParse(payload).success ? { ok: true } : { ok: false, error: "حمولة الإيداع غير صالحة" };
      case "withdrawal.create":
        return withdrawalPayloadSchema.safeParse(payload).success ? { ok: true } : { ok: false, error: "حمولة السحب غير صالحة" };
      case "adjustment.create":
        return adjustmentPayloadSchema.safeParse(payload).success ? { ok: true } : { ok: false, error: "حمولة التسوية غير صالحة" };
      case "product.upsert":
        return productUpsertPayloadSchema.safeParse(payload).success ? { ok: true } : { ok: false, error: "حمولة المنتج غير صالحة" };
      case "product.soft_delete":
        return productSoftDeletePayloadSchema.safeParse(payload).success ? { ok: true } : { ok: false, error: "حمولة حذف المنتج غير صالحة" };
      case "inventory.adjust":
        return inventoryAdjustPayloadSchema.safeParse(payload).success ? { ok: true } : { ok: false, error: "حمولة حركة المخزون غير صالحة" };
      case "entity.upsert":
        return entityUpsertPayloadSchema.safeParse(payload).success ? { ok: true } : { ok: false, error: "حمولة الكيان غير صالحة" };
      case "entity.soft_delete":
        return entitySoftDeletePayloadSchema.safeParse(payload).success ? { ok: true } : { ok: false, error: "حمولة الحذف غير صالحة" };
      default:
        return { ok: false, error: "نوع عملية غير مدعوم" };
    }
  } catch {
    return { ok: false, error: "تعذر التحقق من الحمولة" };
  }
}

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

  const parsed = syncPushRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "طلب مزامنة غير صالح" },
      { status: 400 }
    );
  }

  const { operations } = parsed.data;
  const results: SyncPushOpResult[] = [];

  for (const op of operations) {
    const opType = op.opType as SyncOpType;
    if (!(SYNC_OP_TYPES as readonly string[]).includes(opType)) {
      results.push({ clientOpId: null, opType: opType as SyncOpType, ok: false, error: "نوع عملية غير مدعوم" });
      continue;
    }

    const payloadCheck = validatePayload(opType, op.payload);
    if (!payloadCheck.ok) {
      results.push({
        clientOpId:
          typeof op.payload === "object" && op.payload !== null && "clientOpId" in op.payload
            ? String((op.payload as { clientOpId: unknown }).clientOpId)
            : null,
        opType,
        ok: false,
        error: payloadCheck.error
      });
      continue;
    }

    const payloadWithClientOpId: Record<string, unknown> =
      typeof op.payload === "object" && op.payload !== null
        ? {
            ...(op.payload as Record<string, unknown>),
            clientOpId:
              "clientOpId" in (op.payload as Record<string, unknown>)
                ? (op.payload as Record<string, unknown>).clientOpId
                : op.entityId
          }
        : { clientOpId: op.entityId };

    const clientOpId =
      typeof (payloadWithClientOpId as { clientOpId?: unknown }).clientOpId === "string"
        ? ((payloadWithClientOpId as { clientOpId: string }).clientOpId)
        : op.entityId;

    if (!bidSchema.safeParse(op.entityId).success) {
      results.push({ clientOpId, opType, ok: false, error: "معرّف كيان غير صالح" });
      continue;
    }

    const rpcPayload = {
      ...(payloadWithClientOpId as Record<string, unknown>),
      opType
    };

    try {
      const { data, error } = await supabase.rpc("apply_sync_operation", {
        bid: op.businessId,
        op: rpcPayload
      });

      if (error) {
        const isDuplicate = /DUPLICATE/i.test(error.message);
        results.push({
          clientOpId,
          opType,
          ok: isDuplicate,
          duplicate: isDuplicate,
          error: isDuplicate ? undefined : error.message
        });
        continue;
      }

      results.push({
        clientOpId:
          data && typeof data === "object" && "clientOpId" in data
            ? String((data as { clientOpId: unknown }).clientOpId)
            : clientOpId,
        opType,
        ok: true,
        duplicate:
          data && typeof data === "object" && "duplicate" in data
            ? Boolean((data as { duplicate: unknown }).duplicate)
            : false
      });
    } catch (rpcError) {
      results.push({
        clientOpId,
        opType,
        ok: false,
        error: rpcError instanceof Error ? rpcError.message : "خطأ في الخادم"
      });
    }
  }

  const response: SyncPushResponse = {
    ok: results.every((result) => result.ok),
    results,
    serverTime: new Date().toISOString()
  };
  return NextResponse.json(response);
}
