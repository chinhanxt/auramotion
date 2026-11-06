import { JobGrid } from "@/components/library/JobGrid";

export const metadata = { title: "Thư viện · AuraMotion" };

export default function LibraryPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Thư viện</h1>
      <JobGrid />
    </div>
  );
}
