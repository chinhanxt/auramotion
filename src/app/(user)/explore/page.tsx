import { FeatureTiles, SectionHead } from "@/components/landing/Sections";
import { ExploreGrid, ThemeStrip } from "@/components/landing/Showcase";

export const metadata = { title: "Khám phá · AuraMotion" };

export default function ExplorePage() {
  return (
    <div className="pb-16">
      <section className="px-3 pt-3 sm:px-5 lg:px-6">
        <FeatureTiles compact />
      </section>
      <section className="pt-12">
        <div className="px-3 sm:px-5 lg:px-6">
          <SectionHead kicker="Chủ đề" title="Chọn một chất ảnh" />
        </div>
        <ThemeStrip />
      </section>
      <section className="px-3 pt-12 sm:px-5 lg:px-6">
        <SectionHead kicker="Nổi bật" title="Cộng đồng đang tạo" />
        <ExploreGrid limit={60} />
      </section>
    </div>
  );
}
