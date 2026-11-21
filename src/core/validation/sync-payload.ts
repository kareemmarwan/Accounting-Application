import { z } from "zod";

const uuid = z.string().uuid("معرّف غير صالح");
const iso = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), "تاريخ غير صالح");
const minor = z
  .number()
  .int("مبلغ غير صحيح")
  .nonnegative("مبلغ سالب غير مسموح");
const nullableUuid = uuid.nullable();
const text = z.string().max(500, "نص طويل جداً");

export const SYNC_ENTITY_TYPES = [
  "customers",
  "suppliers",
  "financial_accounts",
  "expense_categories"
] as const;

export type SyncEntityType = (typeof SYNC_ENTITY_TYPES)[number];

export const SYNC_OP_TYPES = [
  "sale.create",
  "purchase.create",
  "expense.create",
  "debt_payment.create",
  "manual_debt.create",
  "transfer.create",
  "deposit.create",
  "withdrawal.create",
  "adjustment.create",
  "entity.upsert",
  "entity.soft_delete"
] as const;

export type SyncOpType = (typeof SYNC_OP_TYPES)[number];

const paymentMethodSchema = z.enum([
  "cash",
  "bank_transfer",
  "palpay",
  "jawwal_pay",
  "electronic",
  "credit"
]);

const cashPaymentMethodSchema = z.enum([
  "cash",
  "bank_transfer",
  "palpay",
  "jawwal_pay",
  "electronic"
]);

export const salePayloadSchema = z
  .object({
    clientOpId: uuid,
    createdAt: iso,
    opType: z.literal("sale.create").optional(),
    sale: z.object({
      id: uuid,
      occurredAt: iso,
      customerId: nullableUuid,
      description: text,
      totalAmountMinor: minor,
      discountMinor: minor,
      netAmountMinor: minor,
      paymentMethod: paymentMethodSchema,
      accountId: nullableUuid,
      paidAmountMinor: minor,
      remainingAmountMinor: minor,
      debtId: nullableUuid,
      notes: text
    }),
    debt: z
      .object({
        id: uuid,
        direction: z.literal("receivable"),
        partyId: uuid,
        amountMinor: z.number().int().positive()
      })
      .nullable()
  })
  .superRefine((data, ctx) => {
    const { totalAmountMinor, discountMinor, netAmountMinor, paidAmountMinor, remainingAmountMinor } = data.sale;
    if (netAmountMinor !== totalAmountMinor - discountMinor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sale", "netAmountMinor"],
        message: "الصافي لا يطابق الإجمالي − الخصم"
      });
    }
    if (paidAmountMinor > netAmountMinor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sale", "paidAmountMinor"],
        message: "المدفوع أكبر من الصافي"
      });
    }
    if (remainingAmountMinor !== netAmountMinor - paidAmountMinor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sale", "remainingAmountMinor"],
        message: "المتبقي لا يطابق الصافي − المدفوع"
      });
    }
  });

export const purchasePayloadSchema = z
  .object({
    clientOpId: uuid,
    createdAt: iso,
    opType: z.literal("purchase.create").optional(),
    purchase: z.object({
      id: uuid,
      occurredAt: iso,
      supplierId: nullableUuid,
      description: text,
      totalAmountMinor: minor,
      discountMinor: minor,
      netAmountMinor: minor,
      paymentMethod: paymentMethodSchema,
      accountId: nullableUuid,
      paidAmountMinor: minor,
      remainingAmountMinor: minor,
      transferReference: z.string().max(100).nullable(),
      receiptAttachmentId: nullableUuid,
      debtId: nullableUuid,
      notes: text
    }),
    debt: z
      .object({
        id: uuid,
        direction: z.literal("payable"),
        partyId: uuid,
        amountMinor: z.number().int().positive()
      })
      .nullable()
  })
  .superRefine((data, ctx) => {
    const { totalAmountMinor, discountMinor, netAmountMinor, paidAmountMinor, remainingAmountMinor } = data.purchase;
    if (netAmountMinor !== totalAmountMinor - discountMinor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["purchase", "netAmountMinor"],
        message: "الصافي لا يطابق الإجمالي − الخصم"
      });
    }
    if (paidAmountMinor > netAmountMinor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["purchase", "paidAmountMinor"],
        message: "المدفوع أكبر من الصافي"
      });
    }
    if (remainingAmountMinor !== netAmountMinor - paidAmountMinor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["purchase", "remainingAmountMinor"],
        message: "المتبقي لا يطابق الصافي − المدفوع"
      });
    }
  });

export const expensePayloadSchema = z.object({
  clientOpId: uuid,
  createdAt: iso,
  opType: z.literal("expense.create").optional(),
  expense: z.object({
    id: uuid,
    title: z.string().min(1).max(200),
    categoryId: uuid,
    glCode: z.string().regex(/^5\d{3}$/, "رمز تصنيف المصروف غير صالح"),
    amountMinor: z.number().int().positive(),
    occurredAt: iso,
    paymentMethod: cashPaymentMethodSchema,
    accountId: uuid,
    receiptAttachmentId: nullableUuid,
    notes: text
  })
});

export const debtPaymentPayloadSchema = z.object({
  clientOpId: uuid,
  createdAt: iso,
  opType: z.literal("debt_payment.create").optional(),
  payment: z.object({
    id: uuid,
    debtId: uuid,
    direction: z.enum(["receivable", "payable"]),
    partyId: uuid,
    occurredAt: iso,
    amountMinor: z.number().int().positive(),
    accountId: uuid,
    paymentMethod: cashPaymentMethodSchema,
    notes: text
  }),
  debtUpdate: z.object({
    id: uuid,
    paidAmountMinor: minor,
    remainingAmountMinor: minor,
    status: z.enum(["open", "partial", "settled"])
  })
});

export const manualDebtPayloadSchema = z.object({
  clientOpId: uuid,
  createdAt: iso,
  opType: z.literal("manual_debt.create").optional(),
  debt: z.object({
    id: uuid,
    direction: z.enum(["receivable", "payable"]),
    partyId: uuid,
    occurredAt: iso,
    amountMinor: z.number().int().positive(),
    notes: text
  })
});

export const transferPayloadSchema = z.object({
  clientOpId: uuid,
  createdAt: iso,
  opType: z.literal("transfer.create").optional(),
  transfer: z.object({
    id: uuid,
    fromAccountId: uuid,
    toAccountId: uuid,
    amountMinor: z.number().int().positive(),
    occurredAt: iso,
    notes: z.string().max(300).nullable()
  })
});

export const depositPayloadSchema = z.object({
  clientOpId: uuid,
  createdAt: iso,
  opType: z.literal("deposit.create").optional(),
  deposit: z.object({
    id: uuid,
    accountId: uuid,
    amountMinor: z.number().int().positive(),
    occurredAt: iso,
    notes: z.string().max(300).nullable()
  })
});

export const withdrawalPayloadSchema = z.object({
  clientOpId: uuid,
  createdAt: iso,
  opType: z.literal("withdrawal.create").optional(),
  withdrawal: z.object({
    id: uuid,
    accountId: uuid,
    amountMinor: z.number().int().positive(),
    occurredAt: iso,
    notes: z.string().max(300).nullable()
  })
});

export const adjustmentPayloadSchema = z
  .object({
    clientOpId: uuid,
    createdAt: iso,
    opType: z.literal("adjustment.create").optional(),
    adjustment: z.object({
      id: uuid,
      accountId: uuid,
      countedBalanceMinor: minor,
      currentBalanceMinor: minor,
      diffMinor: z.number().int().refine((value) => value !== 0, "فرق تسوية صفر"),
      occurredAt: iso,
      notes: z.string().max(300).nullable()
    })
  })
  .refine(
    (data) =>
      data.adjustment.diffMinor ===
      data.adjustment.countedBalanceMinor - data.adjustment.currentBalanceMinor,
    { message: "فرق التسوية لا يطابق المعدود − الدفتري", path: ["adjustment", "diffMinor"] }
  );

export const entityUpsertPayloadSchema = z.discriminatedUnion("entityType", [
  z.object({
    clientOpId: uuid,
    createdAt: iso,
    entityType: z.literal("customers"),
    row: z.object({
      id: uuid,
      name: z.string().min(2).max(120),
      phone: z.string().max(24).nullable().optional(),
      address: z.string().max(200).nullable().optional(),
      notes: z.string().max(500).nullable().optional()
    }),
    expectedVersion: z.number().int().positive().optional()
  }),
  z.object({
    clientOpId: uuid,
    createdAt: iso,
    entityType: z.literal("suppliers"),
    row: z.object({
      id: uuid,
      name: z.string().min(2).max(120),
      phone: z.string().max(24).nullable().optional(),
      address: z.string().max(200).nullable().optional(),
      notes: z.string().max(500).nullable().optional()
    }),
    expectedVersion: z.number().int().positive().optional()
  }),
  z.object({
    clientOpId: uuid,
    createdAt: iso,
    entityType: z.literal("financial_accounts"),
    row: z.object({
      id: uuid,
      name: z.string().min(2).max(120),
      type: z.enum(["cash", "bank", "wallet", "other"]),
      provider: z.string().max(60).nullable().optional(),
      isActive: z.boolean().optional()
    }),
    expectedVersion: z.number().int().positive().optional()
  })
]);

export const entitySoftDeletePayloadSchema = z.object({
  clientOpId: uuid,
  createdAt: iso,
  entityType: z.enum(SYNC_ENTITY_TYPES),
  entityId: uuid
});

export const syncOperationSchema = z.object({
  businessId: uuid,
  opType: z.enum(SYNC_OP_TYPES),
  entityType: z.string().min(1),
  entityId: uuid,
  payload: z.unknown()
});

export type SyncOperation = z.infer<typeof syncOperationSchema>;

export const syncPushRequestSchema = z.object({
  deviceId: z.string().min(8).max(64),
  operations: z.array(syncOperationSchema).min(1).max(100)
});

export type SyncPushRequest = z.infer<typeof syncPushRequestSchema>;

export interface SyncPushOpResult {
  clientOpId: string | null;
  opType: SyncOpType;
  ok: boolean;
  error?: string;
  duplicate?: boolean;
}

export interface SyncPushResponse {
  ok: boolean;
  results: SyncPushOpResult[];
  serverTime: string;
}

export const syncPullRequestSchema = z.object({
  deviceId: z.string().min(8).max(64),
  since: z.string().nullable()
});

export interface SyncPullDelta {
  table: string;
  rows: Array<Record<string, unknown>>;
}

export interface SyncPullResponse {
  ok: boolean;
  serverTime: string;
  watermark: string;
  deltas: SyncPullDelta[];
}
