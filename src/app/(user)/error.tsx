"use client";

import { Button, LinkButton } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

export default function UserError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-5 px-6 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-m3 bg-danger/10 text-danger hairline">
        <Icon name="alert" size={24} />
      </span>
      <div className="space-y-1.5">
        <h1 className="t-h2">Có lỗi khi tải trang</h1>
        <p className="text-sm text-muted">Thử lại, hoặc quay về Studio.</p>
      </div>
      <div className="flex gap-2">
        <Button variant="primary" icon="refresh" onClick={reset}>
          Thử lại
        </Button>
        <LinkButton href="/studio/image" variant="outline">
          Về Studio
        </LinkButton>
      </div>
    </div>
  );
}
