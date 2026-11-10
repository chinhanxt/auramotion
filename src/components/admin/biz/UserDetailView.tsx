"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { jsonInit, useAction } from "@/components/admin/hooks";
import { DataList, FieldRow, KV, NumberInput, PageHeader, Panel, Stat, TextInput } from "@/components/admin/kit";
import { KIND_ICON, KIND_LABEL, TXN_LABEL, formatDateTime } from "@/components/admin/format";
import type { Plain } from "@/components/admin/plain";
import { Avatar, Badge } from "@/components/ui/Bits";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Controls";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog } from "@/components/ui/Overlay";
import { Segmented } from "@/components/ui/Segmented";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { STATUS_LABEL, STATUS_TONE, api, formatCredit, jobErrorText } from "@/lib/api-client";
import type { getUserDetail } from "@/server/services/admin";
import { PLAN_NAME, UserBadges } from "./UsersView";

type Data = Plain<Awaited<ReturnType<typeof getUserDetail>>>;
type Txn = Data["transactions"][number];
type Job = Data["jobs"][number];
type PlanCode = "free" | "pro" | "ultra";

export function UserDetailView({ data, self }: { data: Data; self: boolean }) {
  const router = useRouter();
  const { run, isBusy } = useAction();
  const toast = useToast();
  const { user, balance, subscription, transactions, jobs } = data;
  const locked = user.status === "LOCKED";

  const [confirm, setConfirm] = useState<null | "lock" | "plan">(null);
  const [planCode, setPlanCode] = useState<PlanCode>((subscription?.plan.code as PlanCode) ?? "free");
  const [period, setPeriod] = useState<"MONTH" | "YEAR">(subscription?.period ?? "MONTH");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const url = `/api/admin/users/${user.id}`;

  async function setStatus(status: "ACTIVE" | "LOCKED") {
    const ok = await run("status", () => api(url, jsonInit("PATCH", { status })), { success: status === "LOCKED" ? "Đã khóa" : "Đã mở khóa" });
    setConfirm(null);
    if (ok) router.refresh();
  }

  async function changePlan() {
    const ok = await run("plan", () => api(url, jsonInit("PATCH", { planCode, period })), { success: `Đã đổi sang ${PLAN_NAME[planCode]}` });
    setConfirm(null);
    if (ok) router.refresh();
  }

  async function adjust() {
    const n = Number(amount);
    if (!amount || !Number.isFinite(n) || n === 0) return void toast.error("Nhập số Credit khác 0");
    if (!reason.trim()) return void toast.error("Nhập lý do");
    const ok = await run("adjust", () => api(`${url}/credits`, jsonInit("POST", { amount: n, reason: reason.trim() })), {
      success: `${n > 0 ? "+" : ""}${formatCredit(n)} Credit`,
    });
    if (ok) {
      setAmount("");
      setReason("");
      router.refresh();
    }
  }

  const samePlan = subscription?.plan.code === planCode && (planCode === "free" || subscription?.period === period);

  return (
    <>
      <PageHeader
        back={{ href: "/admin/users", label: "Người dùng" }}
        title={
          <span className="flex min-w-0 items-center gap-3">
            <Avatar name={user.name || user.email} url={user.avatarUrl} size={36} />
            <span className="truncate">{user.email}</span>
          </span>
        }
        sub={<UserBadges role={user.role} status={user.status} />}
        actions={
          !self &&
          (locked ? (
            <Button size="sm" variant="outline" icon="lock" loading={isBusy("status")} onClick={() => setStatus("ACTIVE")}>
              Mở khóa
            </Button>
          ) : (
            <Button size="sm" variant="danger" icon="lock" onClick={() => setConfirm("lock")}>
              Khóa
            </Button>
          ))
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat i={0} label="Khả dụng" icon="bolt" tone="accent" value={formatCredit(balance.available)} />
        <Stat i={1} label="Credit gói" icon="tag" value={formatCredit(balance.plan)} />
        <Stat i={2} label="Credit mua" icon="coin" value={formatCredit(balance.purchased)} />
        <Stat i={3} label="Đang giữ" icon="clock" value={formatCredit(balance.held)} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Thông tin" icon="user">
          <KV
            items={[
              ["Tên", user.name || "—"],
              ["Đăng nhập", user.hasGoogle ? "Google" : "Email"],
              ["Ngày tạo", formatDateTime(user.createdAt)],
              ["Gói", subscription ? `${subscription.plan.name} · ${subscription.period === "YEAR" ? "năm" : "tháng"}` : "—"],
              ["Hết hạn", subscription?.endAt ? formatDateTime(subscription.endAt) : "Không"],
            ]}
          />
        </Panel>

        <Panel title="Đổi gói" icon="tag">
          <div className="space-y-3">
            <FieldRow label="Gói">
              <Select inputSize="sm" value={planCode} onChange={(e) => setPlanCode(e.target.value as PlanCode)}>
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="ultra">Ultra</option>
              </Select>
            </FieldRow>
            <Segmented
              size="sm"
              block
              ariaLabel="Kỳ hạn"
              value={period}
              onChange={setPeriod}
              options={[
                { value: "MONTH" as const, label: "Tháng", disabled: planCode === "free" },
                { value: "YEAR" as const, label: "Năm", disabled: planCode === "free" },
              ]}
            />
            <Button size="sm" variant="subtle" block icon="check" disabled={samePlan} onClick={() => setConfirm("plan")}>
              Đổi gói
            </Button>
          </div>
        </Panel>

        <Panel title="Cộng / trừ Credit" icon="coin">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {[10, 50, 100, -10].map((n) => (
                <Chip key={n} onClick={() => setAmount(String(n))} active={amount === String(n)}>
                  {n > 0 ? `+${n}` : n}
                </Chip>
              ))}
            </div>
            <NumberInput value={amount} onChange={setAmount} placeholder="Số Credit (âm = trừ)" suffix="Credit" aria-label="Số Credit" />
            <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Lý do (bắt buộc)" aria-label="Lý do" />
            <Button size="sm" variant="primary" block loading={isBusy("adjust")} disabled={!amount || !reason.trim()} onClick={adjust}>
              Điều chỉnh
            </Button>
          </div>
        </Panel>
      </div>

      <h2 className="mt-8 mb-3 flex items-center gap-2 text-sm font-semibold">
        <Icon name="coin" size={16} className="text-muted" />
        Giao dịch <span className="text-xs font-normal text-dim">50 gần nhất</span>
      </h2>
      <DataList<Txn>
        rows={transactions}
        rowKey={(t) => t.id}
        dense
        cols={[
          { key: "time", label: "Thời gian", cell: (t) => <span className="whitespace-nowrap text-muted">{formatDateTime(t.createdAt)}</span> },
          { key: "type", label: "Loại", mobile: "title", cell: (t) => TXN_LABEL[t.type] ?? t.type },
          { key: "bucket", label: "Nguồn", cell: (t) => <Badge>{t.bucket === "PLAN" ? "Gói" : "Mua"}</Badge> },
          {
            key: "amount",
            label: "Credit",
            align: "right",
            cell: (t) => {
              const n = Number(t.amount);
              return <span className={cx("font-semibold tabular-nums", n < 0 ? "text-fg/80" : "text-ok")}>{`${n > 0 ? "+" : ""}${formatCredit(n)}`}</span>;
            },
          },
          { key: "note", label: "Ghi chú", cell: (t) => <span className="line-clamp-1 text-muted">{t.note ?? ""}</span> },
        ]}
      />

      <h2 className="mt-8 mb-3 flex items-center gap-2 text-sm font-semibold">
        <Icon name="list" size={16} className="text-muted" />
        Tác vụ <span className="text-xs font-normal text-dim">50 gần nhất</span>
      </h2>
      <DataList<Job>
        rows={jobs}
        rowKey={(j) => j.id}
        dense
        cols={[
          { key: "time", label: "Thời gian", cell: (j) => <span className="whitespace-nowrap text-muted">{formatDateTime(j.createdAt)}</span> },
          {
            key: "kind",
            label: "Loại",
            cell: (j) => (
              <span className="inline-flex items-center gap-1.5">
                <Icon name={KIND_ICON[j.kind]} size={15} className="text-muted" />
                {KIND_LABEL[j.kind]}
              </span>
            ),
          },
          { key: "model", label: "Model", cell: (j) => j.model.name },
          { key: "prompt", label: "Prompt", mobile: "title", cell: (j) => <span className="line-clamp-2 max-w-md">{j.prompt || "—"}</span> },
          { key: "cost", label: "Credit", align: "right", cell: (j) => <span className="tabular-nums">{formatCredit(j.cost)}</span> },
          {
            key: "status",
            label: "Trạng thái",
            cell: (j) => (
              <span className="inline-flex flex-col items-end gap-1 md:items-start">
                <span className="flex gap-1">
                  <Badge tone={STATUS_TONE[j.status]}>{STATUS_LABEL[j.status]}</Badge>
                  {j.deletedAt && <Badge>Đã xóa</Badge>}
                </span>
                {j.error && <span className="text-xs text-danger">{jobErrorText(j.error)}</span>}
              </span>
            ),
          },
        ]}
      />

      <ConfirmDialog
        open={confirm === "lock"}
        title="Khóa tài khoản?"
        body={user.email}
        confirmLabel="Khóa"
        danger
        busy={isBusy("status")}
        onConfirm={() => setStatus("LOCKED")}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "plan"}
        title={`Đổi sang ${PLAN_NAME[planCode]}?`}
        body={planCode === "free" ? "Credit gói hiện tại sẽ bị bỏ." : `Kỳ ${period === "YEAR" ? "năm" : "tháng"} · cấp Credit gói mới.`}
        confirmLabel="Đổi gói"
        busy={isBusy("plan")}
        onConfirm={changePlan}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
