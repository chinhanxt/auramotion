import { redirect } from "next/navigation";

// Trang AI Gateway cũ đã gộp vào AI & Model.
export default function AdminGatewayPage() {
  redirect("/admin/ai");
}
