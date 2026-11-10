"use client";

import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Bits";

export default function AdminError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <Empty
      icon="alert"
      title="Không tải được trang"
      hint={error.message?.slice(0, 200) || "Thử lại sau giây lát"}
      action={
        <Button variant="outline" size="sm" icon="refresh" onClick={reset}>
          Thử lại
        </Button>
      }
    />
  );
}
