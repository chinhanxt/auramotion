"use client";

import { useEffect, useState } from "react";
import { FileDrop } from "@/components/admin/FileDrop";
import { jsonInit, useAction } from "@/components/admin/hooks";
import { Panel, TextInput } from "@/components/admin/kit";
import { Skeleton } from "@/components/ui/Bits";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Overlay";
import { api } from "@/lib/api-client";

type Qr = { url: string; updatedAt: string; note?: string } | null;

// Mã QR nhận tiền: tải ảnh QR ngân hàng / ví lên, trang thanh toán của người dùng sẽ hiện ảnh này.
export function QrUploader() {
  const { run, isBusy } = useAction();
  const [qr, setQr] = useState<Qr | undefined>(undefined);
  const [note, setNote] = useState("");
  const [del, setDel] = useState(false);

  useEffect(() => {
    api<{ qr: Qr }>("/api/admin/payments/qr")
      .then((r) => {
        setQr(r.qr);
        setNote(r.qr?.note ?? "");
      })
      .catch(() => setQr(null));
  }, []);

  async function upload(file: File) {
    const fd = new FormData();
    fd.set("file", file);
    if (note.trim()) fd.set("note", note.trim());
    const r = await run("up", () => api<{ qr: Qr }>("/api/admin/payments/qr", { method: "POST", body: fd }), { success: "Đã cập nhật mã QR" });
    if (r) setQr(r.qr);
  }

  async function remove() {
    const ok = await run("del", () => api("/api/admin/payments/qr", jsonInit("DELETE")), { success: "Đã gỡ mã QR, dùng QR tự sinh" });
    setDel(false);
    if (ok) {
      setQr(null);
      setNote("");
    }
  }

  return (
    <Panel title="Mã QR nhận tiền" icon="qr">
      {qr === undefined ? (
        <Skeleton className="aspect-square w-full max-w-[220px] rounded-m3" />
      ) : (
        <div className="space-y-3">
          {qr ? (
            <div className="flex items-start gap-4">
              <div className="w-36 shrink-0 rounded-m2 bg-white p-2 shadow-[0_12px_40px_-12px_rgba(0,0,0,.8)] sm:w-44">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`${qr.url}?v=${encodeURIComponent(qr.updatedAt)}`} alt="Mã QR nhận tiền" className="aspect-square w-full object-contain" />
              </div>
              <div className="min-w-0 flex-1 space-y-2 text-sm">
                <p className="font-medium text-ok">Đang dùng ảnh này</p>
                <p className="text-xs text-dim">Cập nhật {new Date(qr.updatedAt).toLocaleString("vi-VN")}</p>
                <Button size="sm" variant="ghost" icon="trash" onClick={() => setDel(true)}>
                  Gỡ mã QR
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">Chưa tải mã QR riêng — đang dùng QR tự sinh theo biến BANK_* (có sẵn số tiền và nội dung).</p>
          )}
          <FileDrop accept="image/png,image/jpeg,image/webp" icon="qr" busy={isBusy("up")} title={qr ? "Thay bằng ảnh QR khác" : "Tải ảnh QR lên"} hint="PNG, JPG, WebP · tối đa 4 MB · kéo thả vào đây" onFile={upload} />
          <label className="block space-y-1.5">
            <span className="text-xs text-muted">Ghi chú dưới mã (tùy chọn)</span>
            <TextInput value={note} maxLength={200} placeholder="Vd: Quét bằng app ngân hàng, nhập đúng số tiền" onChange={(e) => setNote(e.target.value)} />
          </label>
          <p className="text-xs text-dim">Ảnh QR cố định không chứa số tiền / nội dung: trang thanh toán vẫn hiện số tiền và mã đơn để người dùng nhập tay. Ghi chú được áp khi tải ảnh lên.</p>
        </div>
      )}
      <ConfirmDialog open={del} title="Gỡ mã QR đã tải lên?" body="Trang thanh toán quay về QR tự sinh theo cấu hình ngân hàng." confirmLabel="Gỡ" danger busy={isBusy("del")} onConfirm={remove} onClose={() => setDel(false)} />
    </Panel>
  );
}
