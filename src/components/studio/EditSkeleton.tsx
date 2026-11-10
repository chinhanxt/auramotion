export function EditSkeleton() {
  return (
    <div className="px-3 pt-3 sm:px-5 lg:px-6">
      <div className="skel mb-4 h-9 w-24 rounded-m1" />
      <div className="grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)_360px] xl:grid-cols-[320px_minmax(0,1fr)_380px]">
        <div className="skel hidden min-h-[420px] rounded-m3 lg:block" />
        <div className="skel min-h-[300px] rounded-m3 lg:min-h-[420px]" />
        <div className="skel min-h-[240px] rounded-m3 lg:min-h-[420px]" />
      </div>
      <div className="skel mt-3 h-[150px] rounded-m3" />
    </div>
  );
}
