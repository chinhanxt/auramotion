// Tạo bìa thật cho preset: STYLE = ảnh Muse, CAMERA = video Muse 5 s thể hiện đúng chuyển động máy.
// Job miễn phí (Admin), xong thì worker gán preset.cover (applyCover). Worker phải đang chạy.
// Dùng: npx tsx --env-file=.env scripts/gen-covers.ts [--only slug,slug] [--force]
import { db } from "@/lib/db";
import { createJob } from "@/server/services/job";

// Chủ thể riêng cho từng phong cách: chọn cảnh làm nổi chất của style. Không chữ, không logo.
const STYLE_SUBJECT: Record<string, string> = {
  "son-mai": "a pair of red-crowned cranes standing among lotus leaves beside a curved bamboo bridge",
  "dong-ho": "a plump pig and her piglets beside a blooming lotus pond, festive Tet folk scene",
  "thuy-mac": "a lone fisherman on a small boat drifting between karst mountains in morning mist",
  "dong-duong-1930": "a young woman in a flowing ao dai holding a paper parasol on a tree-lined Hanoi boulevard, vintage tram behind",
  "cyber-lotus-saigon": "a girl in a translucent raincoat riding a scooter through a rainy Saigon alley under glowing lotus neon",
  "cinematic-teal-orange": "a lone traveller standing at the edge of a rooftop at dusk above a sprawling city",
  "film-35mm": "two friends laughing on a seaside promenade in late summer light",
  "anime-cel": "a schoolgirl with a red scarf running across a hillside train crossing under huge cumulus clouds",
  "claymation": "a cheerful clay fox baker pulling a loaf of bread out of a tiny wood-fired oven",
  "paper-cutout": "a layered paper forest with a small deer looking up at a crescent moon",
  "low-poly": "a faceted low-poly island with a lighthouse and gentle waves at sunset",
  "vhs-90s": "a teenager on roller skates in front of an arcade at night",
  "tilt-shift-miniature": "a busy Hoi An riverside market with tiny boats and lanterns seen from above",
  "holographic-chrome": "a sculptural perfume bottle floating above a mirror floor with liquid chrome ribbons",
  "dreamcore": "an empty pastel swimming pool in a vast field of clouds with a single open door",
  "liquid-surreal": "a whale swimming slowly through a desert sky filled with floating water spheres",
  "editorial-fashion": "a model in an oversized sculptural silk coat posing against a seamless coloured backdrop",
  "golden-hour-lifestyle": "a young couple sharing iced coffee at a sidewalk cafe table in warm late-afternoon sun",
  "noir-rain": "a detective in a trench coat under a flickering street lamp on a rain-soaked street",
  "watercolor-storybook": "a little girl and her dog walking a winding path to a cottage in a blooming meadow",
  studio: "a glass skincare bottle with a gold cap on a sculpted plinth",
  outdoor: "a pair of white running shoes on a mossy rock beside a mountain stream",
  "in-hand": "a hand holding a frosted glass of iced matcha latte",
  lifestyle: "a ceramic coffee mug and an open book on a linen sofa by a sunlit window",
};

// Mỗi camera: một cảnh ngắn để chuyển động máy hiện rõ (Muse video, đúng 1 chuyển động).
const CAMERA_SUBJECT: Record<string, string> = {
  "cam-slow-dolly": "A bowl of steaming pho on a wooden table in a small Hanoi street eatery, steam curling up.",
  "cam-orbit": "A ceramic vase of white lotus flowers on a pedestal in a softly lit gallery.",
  "cam-crane-up": "A lone cyclist on a quiet road between green rice terraces at sunrise, rising to reveal the valley.",
  "cam-tracking-side": "A woman in a white ao dai walking along a yellow colonial wall, her dress moving in the breeze.",
  "cam-handheld-follow": "A child running through a narrow lantern-lit alley at dusk, lanterns swaying.",
  "cam-locked-off": "Rain falling on a koi pond, koi fish gliding slowly between lily pads.",
  "cam-slow-pan": "Ha Long Bay karst islands in soft morning mist with a wooden junk boat sailing.",
  "cam-fpv-glide": "Low over a winding river through a misty jungle canyon at dawn.",
  "cam-orbit-360": "A vintage red Vespa parked on a cobblestone street with bougainvillea above.",
};

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes("--only") ? new Set(args[args.indexOf("--only") + 1].split(",")) : null;
  const force = args.includes("--force");
  const admin = await db.user.findFirstOrThrow({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } });
  const [imageModels, videoModel] = await Promise.all([
    db.aiModel.findMany({ where: { kind: "IMAGE", provider: "MUSE", enabled: true }, orderBy: { sort: "asc" } }),
    db.aiModel.findFirstOrThrow({ where: { kind: "VIDEO", provider: "MUSE", enabled: true }, orderBy: { sort: "asc" } }),
  ]);
  const presets = await db.preset.findMany({ where: { enabled: true }, orderBy: [{ kind: "asc" }, { sort: "asc" }] });
  let n = 0;
  for (const p of presets) {
    if (only && !only.has(p.slug ?? "")) continue;
    if (!force && p.cover && /^\/media\//.test(p.cover)) continue;
    const slug = p.slug ?? "";
    if (p.kind === "STYLE") {
      const subject = STYLE_SUBJECT[slug] ?? "an evocative scene";
      const prompt = `${subject}. ${p.promptSuffix}. Striking composition, rich detail, no text, no letters, no logos, no watermark.`;
      // Chia đều 2 engine ảnh Muse (2 tài khoản) để chạy song song.
      const model = imageModels[n % imageModels.length];
      await createJob(admin.id, { kind: "image", modelId: model.id, prompt, aspectRatio: "4:5", imageCount: 1 }, { free: true, extraParams: { coverPresetId: p.id } });
      console.log("ảnh  ", model.name.padEnd(11), p.name);
    } else {
      const subject = CAMERA_SUBJECT[slug];
      if (!subject) continue;
      const prompt = `${subject} ${p.promptSuffix[0].toUpperCase()}${p.promptSuffix.slice(1)}, slow and smooth. Natural continuous motion, cinematic light, no text.`;
      await createJob(admin.id, { kind: "video", modelId: videoModel.id, prompt, aspectRatio: "9:16", durationSec: 5 }, { free: true, extraParams: { coverPresetId: p.id } });
      console.log("video", p.name);
    }
    n++;
  }
  console.log(`đã tạo ${n} job bìa`);
  await db.$disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
