"use client";

import { useState } from "react";
import { Loader2, ShieldAlert, Trash2 } from "lucide-react";
import {
  removeMember,
  updateMemberRole
} from "@/features/subscription/server/actions";

const ROLE_OPTIONS = [
  { value: "manager", label: "مدير" },
  { value: "accountant", label: "محاسب" },
  { value: "employee", label: "موظف" }
] as const;

const ROLE_LABELS: Record<string, string> = {
  owner: "مالك",
  manager: "مدير",
  accountant: "محاسب",
  employee: "موظف"
};

const STATUS_LABELS: Record<string, string> = {
  active: "نشط",
  invited: "بانتظار القبول",
  removed: "مُزال"
};

export interface ManagedMember {
  id: string;
  userId: string;
  fullName: string | null;
  role: string;
  status: string;
}

export function MembersManager({
  businessId,
  members,
  viewerUserId
}: {
  businessId: string;
  members: ManagedMember[];
  viewerUserId: string;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isOwner = members.some(
    (member) => member.userId === viewerUserId && member.role === "owner"
  );

  async function handleRoleChange(memberId: string, role: string) {
    setBusyId(memberId);
    setError(null);
    try {
      const result = await updateMemberRole({ businessId, memberId, role });
      if (!result.ok) {
        setError(result.error ?? "تعذر تحديث الدور");
        return;
      }
      window.location.reload();
    } catch {
      setError("أنت دون اتصال — تغيير الأدوار يتطلب الإنترنت");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemove(memberId: string) {
    if (!window.confirm("إزالة هذا العضو من المشروع؟ سيفقد صلاحياته فوراً.")) {
      return;
    }
    setBusyId(memberId);
    setError(null);
    try {
      const result = await removeMember({ businessId, memberId });
      if (!result.ok) {
        setError(result.error ?? "تعذر إزالة العضو");
        return;
      }
      window.location.reload();
    } catch {
      setError("أنت دون اتصال — إزالة الأعضاء تتطلب الإنترنت");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
          {error}
        </div>
      )}

      {members.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted">
                <th className="py-2 text-start font-medium">الاسم</th>
                <th className="py-2 text-start font-medium">الدور</th>
                <th className="py-2 text-start font-medium">الحالة</th>
                {isOwner && <th className="py-2 text-start font-medium">إدارة</th>}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const isSelf = member.userId === viewerUserId;
                const isOwnerRow = member.role === "owner";
                return (
                  <tr key={member.id} className="border-b border-border/60">
                    <td className="py-2.5 font-medium">
                      {member.fullName ?? "—"}
                      {isSelf && <span className="ms-1 text-xs text-muted">(أنت)</span>}
                    </td>
                    <td className="py-2.5">
                      {isOwnerRow ? (
                        ROLE_LABELS[member.role] ?? member.role
                      ) : isOwner ? (
                        <select
                          value={member.role}
                          disabled={busyId === member.id}
                          onChange={(event) =>
                            void handleRoleChange(member.id, event.target.value)
                          }
                          className="rounded-lg border border-border bg-surface px-2 py-1 text-xs"
                        >
                          {ROLE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        ROLE_LABELS[member.role] ?? member.role
                      )}
                    </td>
                    <td className="py-2.5 text-muted">
                      {STATUS_LABELS[member.status] ?? member.status}
                    </td>
                    {isOwner && (
                      <td className="py-2.5">
                        {!isOwnerRow && (
                          <button
                            type="button"
                            onClick={() => void handleRemove(member.id)}
                            disabled={busyId === member.id}
                            className="inline-flex items-center gap-1 rounded-lg border border-danger/40 px-2 py-1 text-xs font-medium text-danger hover:bg-danger/10"
                          >
                            {busyId === member.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                            ) : (
                              <Trash2 className="h-3 w-3" aria-hidden />
                            )}
                            إزالة
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted">
          <ShieldAlert className="h-4 w-4" aria-hidden />
          تعذر عرض الأعضاء — قد تكون صلاحياتك محدودة
        </p>
      )}
    </div>
  );
}
