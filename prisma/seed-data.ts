import type { SkillKind } from "@prisma/client";

// Dữ liệu seed v2: skill viết prompt cho Muse, theme (STYLE) và chuyển động máy (CAMERA).

export type SeedSkill = {
  slug: string;
  name: string;
  kind: SkillKind;
  description: string;
  instructions: string;
  template: string;
  minPlanRank?: number;
  sort: number;
};

export type SeedTheme = {
  slug: string;
  name: string;
  category: string;
  description: string;
  palette: string[];
  cover: string;
  promptSuffix: string;
  sort: number;
  featured?: boolean;
};

// Cách hiểu yêu cầu người dùng: áp cho mọi skill ảnh / video.
const INPUT_RULES = `How to read the request:
- The user's idea is usually Vietnamese (sometimes slang or a few words). Understand the intent fully, then write the prompt in natural English.
- Keep every concrete detail the user gives (subject, colour, place, time of day, mood, product name). Never contradict the idea and never add a second main subject.
- Vietnamese culture must be accurate and specific: name the real thing in English (ao dai, conical non la hat, pho noodle soup, banh mi, Hoi An lanterns, Saigon scooters, karst islands of Ha Long Bay) instead of generic "Asian" wording.
- If a visual style is given, translate it into concrete visual language (materials, palette, light, texture) woven into the description — do not paste it as a list at the end.
- If something is unspecified, choose what makes the most beautiful, believable result.`;

// Luật chung cho prompt ảnh Muse.
const IMAGE_RULES = `Muse image rules:
- ONE English prompt of 40 to 70 words, one paragraph, no lists, no quotation marks.
- Order: main subject (exact material, colour, shape) → action or pose → setting and background → light (source, direction, colour) → camera (angle, lens, depth of field) → mood and style.
- No text, letters, captions, logos or watermarks in the image unless the idea explicitly asks for them.
- Never mention aspect ratio, resolution or image size.`;

// Luật chung cho prompt video Muse (bài học AffKit / EM BÔNG).
const VIDEO_RULES = `Muse video rules (never break them):
- Write the prompt in English, 1 to 3 short sentences, present tense, concrete and visual.
- Exactly ONE camera move per shot, slow and smooth (for example "slow dolly in" or "gentle orbit to the left"). Never combine moves, never "zoom in and out", never pulsing, shaking or repeated zooms, no whip pans, no fast cuts inside a shot.
- Describe continuous motion of the subject (hair in the wind, steam rising, fabric moving) so the clip never looks frozen.
- Never write aspect ratio, resolution, size, "vertical", "portrait", "4K" or frame-format words inside the prompt.
- No on-screen text, captions, logos, watermarks or UI in the picture.
- Characters: lock them in Muse vocabulary = species or archetype + 3 to 5 colour cues (for example "a small orange tabby cat with a white chest, a teal knitted scarf and amber eyes"). Reuse that exact phrase, word for word, every time the character appears.`;

const STORY_RULES = `${INPUT_RULES}
${VIDEO_RULES}
- Shots must flow into each other: end each shot on a pose, object, colour or movement that the next shot begins with (match-cut, shape match, colour match, continuous action across the cut).
- Keep one location family, one light direction and one colour palette across all shots unless the idea demands a change; change it with a motivated transition (door opens, camera passes through an object, light flares).
- Output strict JSON only, no markdown, no comments, no trailing commas, exactly this shape:
{"title": "short Vietnamese title", "shots": [{"title": "short Vietnamese shot title", "prompt": "English Muse video prompt", "camera": "the single camera move in 2-5 English words", "durationSec": number}]}
- Return exactly the requested number of shots, each with durationSec equal to the requested duration.`;

const STORY_TEMPLATE = `Idea: {{idea}}
Visual style: {{style}}
Preferred camera language: {{camera}}
Number of shots: {{shots}}
Duration of each shot: {{duration}} seconds
Final format (do not mention it in prompts): {{aspect}}`;

const IMAGE_JSON = 'Return strict JSON only, no markdown: {"prompt": "..."}';
const VIDEO_JSON = 'Return strict JSON only, no markdown: {"prompt": "..."}';
const SCRIPT_JSON = 'Return strict JSON only, no markdown: {"lines": ["câu 1", "câu 2"]}';

export const SKILLS: SeedSkill[] = [
  {
    slug: "image-product-hero",
    name: "Ảnh sản phẩm nổi bật",
    kind: "IMAGE",
    description: "Ảnh quảng cáo sản phẩm sạch, sáng, chủ thể rõ.",
    instructions: `You are a senior commercial photographer writing prompts for the Muse image model.
${INPUT_RULES}
${IMAGE_RULES}
For products: describe the subject with exact material and colour, placement in frame, surface and backdrop, a real studio lighting setup (key light direction, rim light, soft shadows), lens and depth of field.
- The product is always the hero: centred or on a clear third, fully visible, sharp edges, true colours.
- Props are few and support the product story; nothing covers the label area.
- Labels and packaging stay plain and unbranded (no readable words, no invented brand names); only show a brand name if the user wrote one.
- No text, logos, watermarks or hands unless the idea asks for them.
- Never mention aspect ratio or image size.
${IMAGE_JSON}`,
    template: `Product idea: {{idea}}
Style: {{style}}
Format (do not write it in the prompt): {{aspect}}`,
    sort: 10,
  },
  {
    slug: "image-character-lock",
    name: "Nhân vật nhất quán",
    kind: "IMAGE",
    description: "Ảnh nhân vật với mô tả khóa (loài + màu) để dùng lại ở nhiều cảnh.",
    instructions: `You design recurring characters for Muse.
${INPUT_RULES}
First invent a character lock: species or archetype + 3 to 5 colour cues (fur, clothing, eyes, one signature accessory), at most 20 words, for example "a small orange tabby cat with a white chest, a teal knitted scarf and amber eyes".
Then write ONE English image prompt of 40 to 70 words that starts with that exact lock phrase, shows the full body in a simple readable pose, a clean uncluttered background in the style, even soft light, clear silhouette.
- No text, no extra characters, never mention aspect ratio or size.
${IMAGE_JSON}`,
    template: `Character idea: {{idea}}
Style: {{style}}
Format (do not write it in the prompt): {{aspect}}`,
    sort: 11,
  },
  {
    slug: "image-cinematic-frame",
    name: "Khung hình điện ảnh",
    kind: "IMAGE",
    description: "Một khung hình như cảnh phim, dùng làm khung đầu cho video.",
    instructions: `You are a film director of photography writing a single still frame for Muse that will later become the first frame of a video.
${INPUT_RULES}
Write ONE English prompt of 40 to 70 words: subject and action caught mid-motion, foreground / midground / background layers, motivated light source and its colour, atmosphere (haze, dust, rain, steam), lens feel (35mm, 50mm, anamorphic), colour grade.
- Leave room for one camera move (space in front of the subject).
- No text, no borders, never mention aspect ratio or size.
${IMAGE_JSON}`,
    template: `Scene idea: {{idea}}
Style: {{style}}
Format (do not write it in the prompt): {{aspect}}`,
    sort: 12,
  },
  {
    slug: "video-one-move",
    name: "Video 1 chuyển động máy",
    kind: "VIDEO",
    description: "Một cảnh ngắn, một chuyển động máy mượt, chủ thể chuyển động liên tục.",
    instructions: `You write prompts for the Muse video model.
${INPUT_RULES}
${VIDEO_RULES}
Structure: sentence 1 = subject (with character lock if any) + its continuous action + setting; sentence 2 = the single camera move + light; optional sentence 3 = atmosphere and style.
${VIDEO_JSON}`,
    template: `Idea: {{idea}}
Style: {{style}}
Camera move to use: {{camera}}
Duration: {{duration}} seconds`,
    sort: 20,
  },
  {
    slug: "video-product-reveal",
    name: "Video giới thiệu sản phẩm",
    kind: "VIDEO",
    description: "Sản phẩm xuất hiện đẹp, ánh sáng lướt, một chuyển động máy.",
    instructions: `You write product commercial shots for the Muse video model.
${INPUT_RULES}
${VIDEO_RULES}
- Labels stay plain and unbranded (no readable words, no invented brand names) unless the user wrote a brand.
- The product stays sharp, fully in frame and recognisable for the whole shot; light glides across its surface (a moving highlight, a soft light sweep, condensation drops, steam, particles) to create motion without moving the camera fast.
- Prefer slow dolly in, gentle orbit or slow crane up for products.
${VIDEO_JSON}`,
    template: `Product: {{idea}}
Style: {{style}}
Camera move to use: {{camera}}
Duration: {{duration}} seconds`,
    sort: 21,
  },
  {
    slug: "video-character-motion",
    name: "Video nhân vật chuyển động",
    kind: "VIDEO",
    description: "Nhân vật khóa mô tả, hành động liên tục, máy bám theo nhẹ.",
    instructions: `You animate a recurring character for the Muse video model.
${INPUT_RULES}
${VIDEO_RULES}
- Start the prompt with the character lock phrase (species/archetype + 3 to 5 colour cues). If the idea gives no lock, invent one and keep it under 20 words.
- One clear action with a beginning and an end that fits the duration (walks to the window and looks out, not a list of actions).
- Natural secondary motion: breathing, hair or fur in the breeze, cloth swaying.
${VIDEO_JSON}`,
    template: `Character and action: {{idea}}
Style: {{style}}
Camera move to use: {{camera}}
Duration: {{duration}} seconds`,
    sort: 22,
  },
  {
    slug: "image-food-drink",
    name: "Ảnh món ăn & đồ uống",
    kind: "IMAGE",
    description: "Ảnh món ăn, đồ uống ngon mắt: hơi nóng, giọt nước, chất liệu thật.",
    instructions: `You are a food and beverage photographer writing prompts for the Muse image model.
${INPUT_RULES}
${IMAGE_RULES}
- Make it appetising: visible texture (crispy edges, glossy broth, crumbs, foam), freshness cues (steam, condensation drops, a drizzle mid-pour) and one or two real ingredients as props.
- Real surfaces (worn wood, marble, enamel tray, banana leaf) and natural window light or warm practical light; shallow depth of field, 50mm to 100mm macro feel.
- Vietnamese dishes and drinks must look authentic (correct bowl, herbs, garnish, glass type).
${IMAGE_JSON}`,
    template: `Dish or drink idea: {{idea}}
Style: {{style}}
Format (do not write it in the prompt): {{aspect}}`,
    sort: 13,
  },
  {
    slug: "image-portrait-fashion",
    name: "Chân dung & thời trang",
    kind: "IMAGE",
    description: "Chân dung, người mẫu, trang phục (áo dài, outfit) kiểu tạp chí.",
    instructions: `You are a fashion and portrait photographer writing prompts for the Muse image model.
${INPUT_RULES}
${IMAGE_RULES}
- Describe the person by look, not identity: age range, hair, expression, pose and hands; never a real or famous person.
- Clothing is precise: garment type, fabric, cut, colour, how it falls or moves.
- Pick a deliberate light (soft window light, golden hour backlight, beauty dish, coloured gel) and a background that complements the outfit colour.
- Natural skin texture, flattering three-quarter or eye-level angle, 85mm portrait lens feel.
${IMAGE_JSON}`,
    template: `Portrait / outfit idea: {{idea}}
Style: {{style}}
Format (do not write it in the prompt): {{aspect}}`,
    sort: 14,
  },
  {
    slug: "image-vietnam-landscape",
    name: "Phong cảnh & du lịch Việt Nam",
    kind: "IMAGE",
    description: "Phong cảnh, phố cổ, điểm du lịch Việt Nam đúng chất, giàu không khí.",
    instructions: `You are a travel and landscape photographer writing prompts for the Muse image model.
${INPUT_RULES}
${IMAGE_RULES}
- Name the real geography and architecture correctly (Ha Long karst islands, Sa Pa rice terraces, Hoi An yellow walls and lanterns, Hanoi Old Quarter tube houses, Mekong floating markets, Da Lat pine hills).
- Strong depth: a foreground element, a clear focal point in the midground, layered background.
- One weather and time-of-day choice that sets the mood (morning mist, golden hour, blue hour, after rain) with matching light.
- A small human element is welcome for scale (a boat, a cyclist, a figure in a non la hat) but the place is the hero.
${IMAGE_JSON}`,
    template: `Place / scene idea: {{idea}}
Style: {{style}}
Format (do not write it in the prompt): {{aspect}}`,
    sort: 15,
  },
  {
    slug: "video-food-motion",
    name: "Video món ăn & đồ uống",
    kind: "VIDEO",
    description: "Món ăn, đồ uống chuyển động: khói bốc, rót, khuấy, giọt nước.",
    instructions: `You write food and beverage shots for the Muse video model.
${INPUT_RULES}
${VIDEO_RULES}
- One appetising action carries the shot: steam rising, sauce or milk being poured, noodles lifted with chopsticks, ice settling, foam swirling, a sprinkle of herbs falling.
- Keep the food sharp and centred; light from a warm side window or practical lamp, gentle highlights on glossy surfaces.
- Prefer a slow dolly in, a slow top-down drift or a static locked-off camera.
${VIDEO_JSON}`,
    template: `Dish or drink: {{idea}}
Style: {{style}}
Camera move to use: {{camera}}
Duration: {{duration}} seconds`,
    sort: 23,
  },
  {
    slug: "video-travel-scenic",
    name: "Video phong cảnh & du lịch",
    kind: "VIDEO",
    description: "Cảnh đẹp, điểm du lịch, flycam mượt, không khí rõ.",
    instructions: `You write scenic travel shots for the Muse video model.
${INPUT_RULES}
${VIDEO_RULES}
- The place is the hero: name real Vietnamese geography and architecture correctly when relevant.
- Add living motion in the scene: drifting mist, moving water, boats gliding, lanterns swaying, clouds crossing, birds, people walking far away.
- Prefer aerial glide, slow crane up, slow lateral tracking or a slow pan that reveals the view; light changes gently (sun breaking through mist, golden hour glow).
${VIDEO_JSON}`,
    template: `Place / scene: {{idea}}
Style: {{style}}
Camera move to use: {{camera}}
Duration: {{duration}} seconds`,
    sort: 24,
  },
  {
    slug: "video-fashion-showcase",
    name: "Video thời trang",
    kind: "VIDEO",
    description: "Trình diễn trang phục: dáng đi, vải bay, xoay người nhẹ.",
    instructions: `You write fashion showcase shots for the Muse video model.
${INPUT_RULES}
${VIDEO_RULES}
- The outfit is the hero: describe garment, fabric and colour precisely and show how it moves (silk flowing, skirt swirling, sleeves catching the wind).
- One graceful action: walking toward camera, a slow half turn, adjusting a collar, stepping out of a doorway. No face close-up changes, no outfit changes.
- Prefer a lateral tracking shot, a gentle orbit or a slow dolly back; clean, flattering light.
${VIDEO_JSON}`,
    template: `Outfit / model idea: {{idea}}
Style: {{style}}
Camera move to use: {{camera}}
Duration: {{duration}} seconds`,
    sort: 25,
  },
  {
    slug: "video-animate-still",
    name: "Làm ảnh chuyển động",
    kind: "VIDEO",
    description: "Có ảnh khung đầu: giữ nguyên ảnh, chỉ thêm chuyển động hợp lý.",
    instructions: `You write image-to-video prompts for Muse: the user's image is the FIRST FRAME and Muse sees it.
${INPUT_RULES}
${VIDEO_RULES}
- Do not re-describe or redesign the picture; refer to its subject generally ("the woman", "the product", "the street") and keep identity, outfit, colours and composition unchanged.
- Write only what changes over time: subject motion, secondary motion (hair, fabric, steam, water, leaves, light flicker) and the single camera move.
- Motion is subtle and believable for the scene; nothing new appears and nothing disappears.
${VIDEO_JSON}`,
    template: `What should move: {{idea}}
Style to keep: {{style}}
Camera move to use: {{camera}}
Duration: {{duration}} seconds`,
    sort: 26,
  },
  {
    slug: "story-continuous-flow",
    name: "Kịch bản cảnh nối liền",
    kind: "STORY",
    description: "Nhiều cảnh chảy vào nhau bằng match-cut, một mạch liền.",
    instructions: `You are a music-video director planning a continuous visual flow for the Muse video model. The viewer should feel one unbroken movement through all shots.
${STORY_RULES}
- Plan the chain first: for every cut, decide the shared element (a shape, a colour, a motion direction, an object passing the lens) and write it at the END of shot k and the START of shot k+1.
- Keep the camera moving in a consistent direction across shots (for example always forward, or always drifting right) so cuts feel like one move.`,
    template: STORY_TEMPLATE,
    sort: 30,
  },
  {
    slug: "story-product-ad",
    name: "Kịch bản quảng cáo sản phẩm",
    kind: "STORY",
    description: "Hook → vấn đề → sản phẩm → khoảnh khắc dùng → kết đẹp.",
    instructions: `You are a commercial director planning a short product ad for the Muse video model.
${STORY_RULES}
- Arc: shot 1 is a visual hook (striking motion or texture), middle shots show the product in use and its key benefit visually, the last shot is a clean hero shot of the product.
- Describe the product with the same exact phrase (material + colour + shape) in every shot it appears, like a character lock.
- Never invent prices, discounts or claims; no text on screen.`,
    template: STORY_TEMPLATE,
    sort: 31,
  },
  {
    slug: "story-character-journey",
    name: "Kịch bản hành trình nhân vật",
    kind: "STORY",
    description: "Một nhân vật khóa mô tả đi qua nhiều cảnh có cảm xúc.",
    instructions: `You are an animation story artist planning a short character journey for the Muse video model.
${STORY_RULES}
- Invent ONE character lock (species/archetype + 3 to 5 colour cues, under 20 words) and paste it verbatim at the start of every shot prompt.
- Simple emotional arc: want → obstacle → small change → warm ending. One action per shot.
- The character's screen direction stays consistent (moves left to right through the whole story) unless a shot shows them turning.`,
    template: STORY_TEMPLATE,
    sort: 32,
  },
  {
    slug: "story-mood-montage",
    name: "Kịch bản montage cảm xúc",
    kind: "STORY",
    description: "Chuỗi hình ảnh giàu không khí, nối bằng màu và hình khối.",
    instructions: `You are a visual poet planning a mood montage for the Muse video model.
${STORY_RULES}
- Each shot is one evocative image with gentle continuous motion (petals falling, light shifting, water rippling).
- Cuts are colour matches or shape matches (a round moon becomes a round lantern, a red ribbon becomes a red sunset).
- Light evolves gradually across the montage (dawn to dusk, or neon night to sunrise).`,
    template: STORY_TEMPLATE,
    sort: 33,
  },
  {
    slug: "script-voiceover-vn",
    name: "Lời thoại quảng cáo",
    kind: "SCRIPT",
    description: "Lời đọc tiếng Việt tự nhiên cho video ngắn.",
    instructions: `Bạn là người viết lời thoại quảng cáo tiếng Việt cho video ngắn, giọng đọc tự nhiên như người thật.
- 3 đến 6 câu, mỗi câu tối đa 20 chữ, dễ đọc thành tiếng, có nhịp.
- Câu 1 là câu mở gây chú ý, câu cuối là lời kêu gọi nhẹ nhàng.
- Không bịa giá, khuyến mãi hay công dụng nếu ý tưởng không nhắc tới. Không dùng emoji, không ký hiệu lạ.
${SCRIPT_JSON}`,
    template: `Ý tưởng: {{idea}}
Thời lượng đọc khoảng {{duration}} giây.`,
    sort: 40,
  },
  {
    slug: "script-story-narration",
    name: "Lời dẫn chuyện",
    kind: "SCRIPT",
    description: "Lời dẫn kể chuyện, mỗi câu ứng một cảnh.",
    instructions: `Bạn là người dẫn chuyện cho video nhiều cảnh. Viết lời dẫn tiếng Việt ấm áp, mỗi câu ứng với một cảnh theo thứ tự.
- Đúng số câu bằng số cảnh, mỗi câu tối đa 18 chữ để đọc vừa thời lượng cảnh.
- Lời gợi cảm xúc, không tả lại y nguyên hình ảnh, không emoji.
${SCRIPT_JSON}`,
    template: `Ý tưởng: {{idea}}
Số cảnh: {{shots}}
Mỗi cảnh: {{duration}} giây.`,
    sort: 41,
  },
];

export const THEMES: SeedTheme[] = [
  {
    slug: "son-mai",
    name: "Sơn mài",
    category: "Việt Nam",
    description: "Lớp sơn mài đen bóng, vàng lá, đỏ son, vỏ trứng rạn.",
    palette: ["#0b0b0d", "#8b1e1e", "#c9a227", "#e8dcc0"],
    cover: "radial-gradient(circle at 30% 30%, #c9a227 0%, #8b1e1e 35%, #0b0b0d 75%), #0b0b0d",
    promptSuffix:
      "Vietnamese lacquer painting style, glossy black lacquer ground, gold leaf highlights, vermilion red accents, crackled eggshell inlay texture, deep layered sheen",
    sort: 1,
    featured: true,
  },
  {
    slug: "dong-ho",
    name: "Tranh Đông Hồ",
    category: "Việt Nam",
    description: "Tranh khắc gỗ dân gian, nét đen mộc, màu điệp tự nhiên.",
    palette: ["#e9dcc3", "#b23a2a", "#d6a02b", "#2f5d3a", "#1c1a17"],
    cover: "linear-gradient(135deg, #e9dcc3 0%, #d6a02b 40%, #b23a2a 70%, #2f5d3a 100%)",
    promptSuffix:
      "Vietnamese Dong Ho folk woodblock print style, bold black carved outlines, flat natural pigments of ochre, brick red and leaf green on shimmering scallop-shell paper, naive symmetrical composition",
    sort: 2,
    featured: true,
  },
  {
    slug: "thuy-mac",
    name: "Thủy mặc",
    category: "Việt Nam",
    description: "Mực nho loang trên giấy dó, nhiều khoảng trống.",
    palette: ["#f4f1ea", "#9a9a94", "#3b3b3b", "#111111"],
    cover: "linear-gradient(180deg, #f4f1ea 0%, #9a9a94 55%, #111111 100%)",
    promptSuffix:
      "ink wash painting style on handmade do paper, soft bleeding black ink gradients, generous empty space, misty mountains, minimal brush strokes, monochrome with a single faint accent",
    sort: 3,
    featured: true,
  },
  {
    slug: "dong-duong-1930",
    name: "Đông Dương 1930",
    category: "Việt Nam",
    description: "Sài Gòn – Hà Nội thập niên 30, sepia ấm, nắng xiên.",
    palette: ["#3e2c1c", "#8a6a43", "#c8a97e", "#efe2c6"],
    cover: "linear-gradient(160deg, #efe2c6 0%, #c8a97e 40%, #8a6a43 70%, #3e2c1c 100%)",
    promptSuffix:
      "1930s Indochine era atmosphere, colonial yellow facades, wooden shutters, ao dai silk and linen suits, warm sepia film tones, slanting golden afternoon sun, soft film grain",
    sort: 4,
    featured: true,
  },
  {
    slug: "cyber-lotus-saigon",
    name: "Cyber Lotus Sài Gòn",
    category: "Việt Nam",
    description: "Sài Gòn đêm neon, sen hồng phát sáng, mưa phản chiếu.",
    palette: ["#0a0420", "#ff2d95", "#00e5ff", "#ffd166"],
    cover: "linear-gradient(135deg, #0a0420 0%, #ff2d95 45%, #00e5ff 80%, #ffd166 100%)",
    promptSuffix:
      "cyber lotus Saigon at night, glowing pink lotus motifs on neon signs, wet asphalt reflections, scooters with light trails, magenta and cyan neon haze, warm street food lamps",
    sort: 5,
    featured: true,
  },
  {
    slug: "cinematic-teal-orange",
    name: "Điện ảnh",
    category: "Điện ảnh",
    description: "Ánh sáng phim, tông xanh – cam, chiều sâu rõ.",
    palette: ["#0f2a33", "#1f6f78", "#f4a259", "#f9e0c0"],
    cover: "linear-gradient(120deg, #0f2a33 0%, #1f6f78 45%, #f4a259 85%, #f9e0c0 100%)",
    promptSuffix:
      "cinematic film look, anamorphic lens feel, teal and orange colour grade, motivated practical lighting, soft haze, shallow depth of field",
    sort: 6,
  },
  {
    slug: "film-35mm",
    name: "Phim 35mm",
    category: "Điện ảnh",
    description: "Hạt phim mịn, màu ấm, highlight dịu.",
    palette: ["#2b2118", "#a0522d", "#e3b778", "#f6efe1"],
    cover: "linear-gradient(145deg, #2b2118 0%, #a0522d 45%, #e3b778 80%, #f6efe1 100%)",
    promptSuffix:
      "shot on 35mm film, fine organic grain, warm halation around highlights, gentle contrast, slightly faded blacks, natural skin tones",
    sort: 7,
  },
  {
    slug: "anime-cel",
    name: "Anime cel",
    category: "Hoạt hình",
    description: "Hoạt hình cel tô phẳng, viền sạch, trời xanh mây trắng.",
    palette: ["#2d6cdf", "#9ad0ff", "#ffffff", "#ffb4a2", "#2b2d42"],
    cover: "linear-gradient(180deg, #2d6cdf 0%, #9ad0ff 55%, #ffffff 80%, #ffb4a2 100%)",
    promptSuffix:
      "hand-drawn anime cel animation style, clean ink outlines, flat cel shading with one shadow tone, painted watercolor background, bright summer sky with towering clouds",
    sort: 8,
  },
  {
    slug: "claymation",
    name: "Đất sét",
    category: "Hoạt hình",
    description: "Stop-motion đất sét, dấu vân tay, ánh sáng mô hình.",
    palette: ["#f2c14e", "#f78154", "#4d9078", "#5fad56", "#fdf6e3"],
    cover: "radial-gradient(circle at 50% 40%, #f2c14e 0%, #f78154 40%, #4d9078 80%)",
    promptSuffix:
      "claymation stop-motion style, handmade plasticine characters with visible fingerprints, miniature handcrafted set, soft studio lighting, slightly imperfect charming motion",
    sort: 9,
  },
  {
    slug: "paper-cutout",
    name: "Giấy cắt lớp",
    category: "Hoạt hình",
    description: "Nhiều lớp giấy cắt chồng, bóng đổ mềm.",
    palette: ["#fefae0", "#e9c46a", "#e76f51", "#2a9d8f", "#264653"],
    cover: "linear-gradient(180deg, #fefae0 0%, #e9c46a 30%, #e76f51 55%, #2a9d8f 78%, #264653 100%)",
    promptSuffix:
      "layered paper cutout diorama style, stacked cardstock layers with soft drop shadows between them, visible paper fibre texture, gentle backlight glowing through thin paper",
    sort: 10,
  },
  {
    slug: "low-poly",
    name: "Low-poly",
    category: "Hoạt hình",
    description: "Khối đa giác phẳng, màu chuyển gọn.",
    palette: ["#22223b", "#4a4e69", "#9a8c98", "#c9ada7", "#f2e9e4"],
    cover: "linear-gradient(135deg, #22223b 0%, #4a4e69 30%, #9a8c98 60%, #f2e9e4 100%)",
    promptSuffix:
      "low-poly 3D style, faceted flat-shaded polygons, crisp geometric edges, soft ambient occlusion, clean pastel gradient sky",
    sort: 11,
  },
  {
    slug: "vhs-90s",
    name: "VHS thập niên 90",
    category: "Hoài cổ",
    description: "Băng từ 90s, nhòe màu, đường quét nhẹ.",
    palette: ["#1b1b3a", "#693668", "#a74482", "#f84aa7", "#f2d0a4"],
    cover: "linear-gradient(180deg, #1b1b3a 0%, #693668 35%, #a74482 60%, #f84aa7 85%, #f2d0a4 100%)",
    promptSuffix:
      "1990s VHS camcorder look, soft chroma bleed, faint scan lines, slightly washed colours, warm tungsten indoor light, nostalgic home-video feel",
    sort: 12,
  },
  {
    slug: "tilt-shift-miniature",
    name: "Mô hình tí hon",
    category: "Thử nghiệm",
    description: "Tilt-shift: thế giới thật trông như mô hình đồ chơi.",
    palette: ["#8ecae6", "#219ebc", "#ffb703", "#fb8500", "#90be6d"],
    cover: "linear-gradient(180deg, #8ecae6 0%, #219ebc 35%, #90be6d 65%, #ffb703 85%, #fb8500 100%)",
    promptSuffix:
      "tilt-shift miniature effect, high vantage point, strong blur at top and bottom of frame, saturated toy-like colours, bright midday sun, tiny people and vehicles",
    sort: 13,
  },
  {
    slug: "holographic-chrome",
    name: "Chrome ảo ảnh",
    category: "Thử nghiệm",
    description: "Kim loại chrome phản chiếu cầu vồng, nền tối.",
    palette: ["#0d0d0d", "#c0c0c0", "#a78bfa", "#67e8f9", "#f0abfc"],
    cover: "linear-gradient(135deg, #0d0d0d 0%, #a78bfa 35%, #67e8f9 60%, #f0abfc 80%, #c0c0c0 100%)",
    promptSuffix:
      "holographic liquid chrome surfaces, iridescent rainbow reflections, glossy mirror finish, dark studio void, sharp specular highlights",
    sort: 14,
  },
  {
    slug: "dreamcore",
    name: "Dreamcore",
    category: "Thử nghiệm",
    description: "Mơ màng, pastel mờ sương, không gian lạ mà quen.",
    palette: ["#ffd6e0", "#c3b1e1", "#a0c4ff", "#fdffb6"],
    cover: "radial-gradient(circle at 50% 50%, #fdffb6 0%, #ffd6e0 35%, #c3b1e1 65%, #a0c4ff 100%)",
    promptSuffix:
      "dreamcore aesthetic, soft pastel haze, overexposed glowing light, empty familiar spaces that feel uncanny, floating particles, gentle bloom",
    sort: 15,
  },
  {
    slug: "liquid-surreal",
    name: "Siêu thực lỏng",
    category: "Thử nghiệm",
    description: "Vật thể tan chảy, chất lỏng uốn lượn, logic giấc mơ.",
    palette: ["#03045e", "#0077b6", "#00b4d8", "#ff7aa2", "#ffe5ec"],
    cover: "linear-gradient(150deg, #03045e 0%, #0077b6 35%, #00b4d8 60%, #ff7aa2 85%, #ffe5ec 100%)",
    promptSuffix:
      "liquid surrealism, objects melting and flowing like thick glossy paint, impossible floating forms, smooth slow-motion fluid dynamics, dreamlike calm",
    sort: 16,
  },
  {
    slug: "editorial-fashion",
    name: "Tạp chí thời trang",
    category: "Thời trang",
    description: "Ảnh tạp chí, nền màu đơn, ánh sáng gắt sang.",
    palette: ["#111111", "#f5f0e8", "#c1121f", "#d4a373"],
    cover: "linear-gradient(120deg, #111111 0%, #c1121f 45%, #d4a373 75%, #f5f0e8 100%)",
    promptSuffix:
      "high-fashion editorial look, bold seamless colour backdrop, crisp hard key light with defined shadow, confident pose, luxurious fabric texture, magazine-grade retouching",
    sort: 17,
  },
  {
    slug: "golden-hour-lifestyle",
    name: "Nắng chiều",
    category: "Đời thường",
    description: "Nắng vàng cuối ngày, ngược sáng, ấm áp tự nhiên.",
    palette: ["#ffb347", "#ffcc33", "#f4845f", "#6d597a"],
    cover: "linear-gradient(180deg, #ffcc33 0%, #ffb347 35%, #f4845f 70%, #6d597a 100%)",
    promptSuffix:
      "golden hour backlight, warm sun flare, glowing rim light on hair, soft long shadows, candid natural lifestyle moment",
    sort: 18,
  },
  {
    slug: "noir-rain",
    name: "Noir mưa đêm",
    category: "Điện ảnh",
    description: "Đen trắng tương phản, mưa, bóng rèm sáo.",
    palette: ["#000000", "#2b2b2b", "#7a7a7a", "#e6e6e6"],
    cover: "linear-gradient(160deg, #000000 0%, #2b2b2b 40%, #7a7a7a 75%, #e6e6e6 100%)",
    promptSuffix:
      "film noir style, high-contrast black and white, rain-soaked streets, venetian blind shadows, single hard street lamp, drifting cigarette-like haze",
    sort: 19,
  },
  {
    slug: "watercolor-storybook",
    name: "Màu nước truyện tranh",
    category: "Hoạt hình",
    description: "Màu nước loang nhẹ như sách tranh thiếu nhi.",
    palette: ["#fff8e7", "#a8dadc", "#f1c0b9", "#90a955", "#457b9d"],
    cover: "linear-gradient(135deg, #fff8e7 0%, #f1c0b9 35%, #a8dadc 65%, #457b9d 100%)",
    promptSuffix:
      "children's storybook watercolor illustration, soft wet-on-wet washes, visible paper grain, delicate pencil lines, cosy gentle palette",
    sort: 20,
  },
];

// Mỗi preset camera đúng MỘT chuyển động mượt.
export const CAMERAS: SeedTheme[] = [
  {
    slug: "cam-slow-dolly",
    name: "Dolly tiến chậm",
    category: "Tiến lùi",
    description: "Máy trượt thẳng tới chủ thể, rất chậm.",
    palette: ["#1d3557", "#457b9d", "#f1faee"],
    cover: "radial-gradient(circle at 50% 50%, #f1faee 0%, #457b9d 40%, #1d3557 100%)",
    promptSuffix: "one slow smooth dolly in toward the subject",
    sort: 101,
  },
  {
    slug: "cam-orbit",
    name: "Orbit vòng nhẹ",
    category: "Quanh chủ thể",
    description: "Máy đi vòng cung quanh chủ thể.",
    palette: ["#2b2d42", "#8d99ae", "#edf2f4"],
    cover: "conic-gradient(from 90deg at 50% 50%, #2b2d42, #8d99ae, #edf2f4, #2b2d42)",
    promptSuffix: "one gentle slow orbit around the subject in a smooth arc",
    sort: 102,
  },
  {
    slug: "cam-crane-up",
    name: "Cần cẩu nâng",
    category: "Lên xuống",
    description: "Máy nâng dần lên cao, mở ra toàn cảnh.",
    palette: ["#264653", "#2a9d8f", "#e9c46a"],
    cover: "linear-gradient(0deg, #264653 0%, #2a9d8f 55%, #e9c46a 100%)",
    promptSuffix: "one slow smooth crane up rising above the scene",
    sort: 103,
  },
  {
    slug: "cam-tracking-side",
    name: "Tracking ngang",
    category: "Theo chủ thể",
    description: "Máy đi ngang song song với chủ thể đang di chuyển.",
    palette: ["#3d405b", "#81b29a", "#f2cc8f"],
    cover: "linear-gradient(90deg, #3d405b 0%, #81b29a 55%, #f2cc8f 100%)",
    promptSuffix: "one smooth lateral tracking shot moving alongside the subject at the same speed",
    sort: 104,
  },
  {
    slug: "cam-handheld-follow",
    name: "Cầm tay bám theo",
    category: "Theo chủ thể",
    description: "Máy cầm tay đi sau chủ thể, rung rất nhẹ tự nhiên.",
    palette: ["#5f0f40", "#9a031e", "#fb8b24"],
    cover: "linear-gradient(110deg, #5f0f40 0%, #9a031e 50%, #fb8b24 100%)",
    promptSuffix: "one steady handheld follow shot behind the subject with subtle natural sway",
    sort: 105,
  },
  {
    slug: "cam-locked-off",
    name: "Khóa máy",
    category: "Tĩnh",
    description: "Máy đứng yên, chỉ chủ thể chuyển động.",
    palette: ["#212529", "#6c757d", "#dee2e6"],
    cover: "linear-gradient(180deg, #dee2e6 0%, #6c757d 50%, #212529 100%)",
    promptSuffix: "static locked-off camera on a tripod, only the subject and environment move",
    sort: 106,
  },
  {
    slug: "cam-slow-pan",
    name: "Pan chậm",
    category: "Xoay ngang",
    description: "Máy xoay ngang chậm để lộ dần khung cảnh.",
    palette: ["#003049", "#d62828", "#fcbf49"],
    cover: "linear-gradient(90deg, #003049 0%, #d62828 60%, #fcbf49 100%)",
    promptSuffix: "one slow smooth pan from left to right revealing the scene",
    sort: 107,
  },
  {
    slug: "cam-fpv-glide",
    name: "FPV lướt",
    category: "Bay",
    description: "Máy bay FPV lướt tới mượt, thấp và liền mạch.",
    palette: ["#03071e", "#6a040f", "#f48c06", "#ffba08"],
    cover: "linear-gradient(135deg, #03071e 0%, #6a040f 40%, #f48c06 75%, #ffba08 100%)",
    promptSuffix: "one continuous smooth FPV drone glide forward, low and steady, no sudden turns",
    sort: 108,
  },
];

// Bổ sung trường mới cho preset cũ (chỉ khi chưa có slug).
export const LEGACY_PRESET_META: Record<string, Omit<SeedTheme, "name" | "promptSuffix">> = {
  "STYLE:Studio": { slug: "studio", category: "Sản phẩm", description: "Phông liền, đèn softbox, sản phẩm sắc nét.", palette: ["#f8f9fa", "#dee2e6", "#adb5bd"], cover: "linear-gradient(180deg, #f8f9fa 0%, #dee2e6 60%, #adb5bd 100%)", sort: 50 },
  "STYLE:Ngoài trời": { slug: "outdoor", category: "Đời thường", description: "Ánh sáng tự nhiên, hậu cảnh mờ.", palette: ["#a3c4bc", "#bfd8bd", "#f1e3d3"], cover: "linear-gradient(180deg, #a3c4bc 0%, #bfd8bd 50%, #f1e3d3 100%)", sort: 51 },
  "STYLE:Trên tay": { slug: "in-hand", category: "Sản phẩm", description: "Cận cảnh sản phẩm trên tay người.", palette: ["#e0b1a0", "#f2d0c4", "#faf3ef"], cover: "linear-gradient(180deg, #e0b1a0 0%, #f2d0c4 50%, #faf3ef 100%)", sort: 52 },
  "STYLE:Lifestyle": { slug: "lifestyle", category: "Đời thường", description: "Nhà ấm cúng, ánh đèn vàng.", palette: ["#e9c46a", "#f4a261", "#fefae0"], cover: "linear-gradient(180deg, #fefae0 0%, #e9c46a 50%, #f4a261 100%)", sort: 53 },
  "CAMERA:Zoom In": { slug: "cam-zoom-in", category: "Tiến lùi", description: "Zoom vào chậm.", palette: ["#14213d", "#fca311", "#e5e5e5"], cover: "radial-gradient(circle, #e5e5e5 0%, #fca311 40%, #14213d 100%)", sort: 150 },
  "CAMERA:Zoom Out": { slug: "cam-zoom-out", category: "Tiến lùi", description: "Zoom ra chậm.", palette: ["#14213d", "#fca311", "#e5e5e5"], cover: "radial-gradient(circle, #14213d 0%, #fca311 60%, #e5e5e5 100%)", sort: 151 },
  "CAMERA:Pan trái": { slug: "cam-pan-left", category: "Xoay ngang", description: "Xoay chậm sang trái.", palette: ["#003049", "#fcbf49", "#eae2b7"], cover: "linear-gradient(270deg, #003049 0%, #fcbf49 60%, #eae2b7 100%)", sort: 152 },
  "CAMERA:Pan phải": { slug: "cam-pan-right", category: "Xoay ngang", description: "Xoay chậm sang phải.", palette: ["#003049", "#fcbf49", "#eae2b7"], cover: "linear-gradient(90deg, #003049 0%, #fcbf49 60%, #eae2b7 100%)", sort: 153 },
  "CAMERA:Xoay 360": { slug: "cam-orbit-360", category: "Quanh chủ thể", description: "Đi vòng trọn quanh chủ thể.", palette: ["#2b2d42", "#ef233c", "#edf2f4"], cover: "conic-gradient(#2b2d42, #ef233c, #edf2f4, #2b2d42)", sort: 154 },
  "CAMERA:Tĩnh": { slug: "cam-static", category: "Tĩnh", description: "Máy đứng yên.", palette: ["#212529", "#495057", "#f8f9fa"], cover: "linear-gradient(180deg, #f8f9fa 0%, #495057 60%, #212529 100%)", sort: 155 },
};
