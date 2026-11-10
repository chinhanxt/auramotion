import type { SeedSkill } from "./seed-data";
import { IMAGE_JSON, IMAGE_RULES, INPUT_RULES, SCRIPT_JSON, STORY_RULES, STORY_TEMPLATE, VIDEO_JSON, VIDEO_RULES } from "./seed-data";

// Thư viện skill theo lĩnh vực. Mỗi skill = luật chung (hiểu yêu cầu tiếng Việt + luật Muse) + cách làm riêng của lĩnh vực.
// `tags`: từ khóa KHÔNG DẤU cho bộ chọn skill tầng 1 (lọc nhanh ~10 ứng viên trước khi AI chọn).

export type LibSkill = SeedSkill & { category: string; tags: string[] };

const IMAGE_TEMPLATE = `Idea: {{idea}}
Style: {{style}}
Format (do not write it in the prompt): {{aspect}}`;

const VIDEO_TEMPLATE = `Idea: {{idea}}
Style: {{style}}
Camera move to use: {{camera}}
Duration: {{duration}} seconds`;

function image(slug: string, name: string, category: string, description: string, role: string, focus: string[], tags: string[], sort: number): LibSkill {
  return {
    slug,
    name,
    kind: "IMAGE",
    category,
    description,
    tags,
    instructions: `${role}
${INPUT_RULES}
${IMAGE_RULES}
${focus.map((f) => `- ${f}`).join("\n")}
${IMAGE_JSON}`,
    template: IMAGE_TEMPLATE,
    sort,
  };
}

function video(slug: string, name: string, category: string, description: string, role: string, focus: string[], tags: string[], sort: number): LibSkill {
  return {
    slug,
    name,
    kind: "VIDEO",
    category,
    description,
    tags,
    instructions: `${role}
${INPUT_RULES}
${VIDEO_RULES}
${focus.map((f) => `- ${f}`).join("\n")}
${VIDEO_JSON}`,
    template: VIDEO_TEMPLATE,
    sort,
  };
}

function story(slug: string, name: string, category: string, description: string, role: string, focus: string[], tags: string[], sort: number): LibSkill {
  return {
    slug,
    name,
    kind: "STORY",
    category,
    description,
    tags,
    instructions: `${role}
${STORY_RULES}
${focus.map((f) => `- ${f}`).join("\n")}`,
    template: STORY_TEMPLATE,
    sort,
  };
}

function script(slug: string, name: string, category: string, description: string, body: string[], tags: string[], sort: number): LibSkill {
  return {
    slug,
    name,
    kind: "SCRIPT",
    category,
    description,
    tags,
    instructions: `${body.join("\n")}\n${SCRIPT_JSON}`,
    template: `Ý tưởng: {{idea}}\nThời lượng đọc khoảng {{duration}} giây. Số cảnh: {{shots}}.`,
    sort,
  };
}

const NO_BRAND = "Packaging and labels stay plain and unbranded (no readable words, no invented brand names); show a brand only if the user wrote it.";
const HANDS = "Hands look natural and anatomically correct (five fingers, relaxed grip), clean nails, no jewellery unless asked.";

// Lĩnh vực + từ khóa cho 19 skill có sẵn trong seed-data.
export const SKILL_META: Record<string, { category: string; tags: string[] }> = {
  "image-product-hero": { category: "Sản phẩm", tags: ["san pham", "chai", "hop", "my pham", "nuoc hoa", "packshot", "quang cao", "product", "studio"] },
  "image-character-lock": { category: "Nhân vật", tags: ["nhan vat", "mascot", "linh vat", "character", "con meo", "con cho", "chu meo", "chu cho", "nhat quan", "hoat hinh"] },
  "image-cinematic-frame": { category: "Làm phim", tags: ["dien anh", "canh phim", "cinematic", "khung hinh", "phim", "bau khong khi", "mua dem", "khung dau"] },
  "image-food-drink": { category: "Ẩm thực", tags: ["mon an", "do an", "do uong", "pho", "bun", "banh", "banh mi", "ca phe", "cafe", "tra sua", "nuoc ep", "com", "lau", "nuong", "thit", "xoi", "che", "ngon"] },
  "image-portrait-fashion": { category: "Thời trang", tags: ["chan dung", "nguoi mau", "thoi trang", "ao dai", "portrait", "fashion", "co gai", "chang trai", "beauty"] },
  "image-vietnam-landscape": { category: "Du lịch", tags: ["phong canh", "du lich", "ha long", "hoi an", "sapa", "da lat", "ruong bac thang", "bien", "nui", "pho co", "hue", "mien tay", "landscape"] },
  "video-one-move": { category: "Chung", tags: ["canh", "khung canh", "scene", "video ngan"] },
  "video-product-reveal": { category: "Sản phẩm", tags: ["san pham", "chai", "hop", "my pham", "nuoc hoa", "product", "quang cao", "gioi thieu"] },
  "video-character-motion": { category: "Nhân vật", tags: ["nhan vat", "mascot", "con meo", "con cho", "chu meo", "chu cho", "di bo", "chay", "nhay", "character", "hoat hinh"] },
  "video-food-motion": { category: "Ẩm thực", tags: ["mon an", "do an", "do uong", "pho", "bun", "banh", "banh mi", "ca phe", "tra sua", "nuoc ep", "boc khoi", "rot", "nau an", "ngon"] },
  "video-travel-scenic": { category: "Du lịch", tags: ["phong canh", "du lich", "ha long", "hoi an", "sapa", "da lat", "ruong bac thang", "bien", "nui", "flycam", "drone", "hoang hon", "binh minh"] },
  "video-fashion-showcase": { category: "Thời trang", tags: ["thoi trang", "outfit", "trang phuc", "ao dai", "vay", "dam", "nguoi mau", "catwalk", "lookbook", "mac do"] },
  "video-animate-still": { category: "Chung", tags: ["chuyen dong", "anh dong", "lam anh chuyen dong", "khung dau", "animate"] },
  "story-continuous-flow": { category: "Làm phim", tags: ["cau chuyen", "noi canh", "lien mach", "story", "match cut"] },
  "story-product-ad": { category: "Bán hàng", tags: ["quang cao", "san pham", "ban hang", "tvc", "ads"] },
  "story-character-journey": { category: "Làm phim", tags: ["nhan vat", "hanh trinh", "phieu luu", "cau chuyen", "hoat hinh"] },
  "story-mood-montage": { category: "Vlog", tags: ["montage", "cam xuc", "mood", "ky niem", "vlog"] },
  "script-voiceover-vn": { category: "Bán hàng", tags: ["loi thoai", "quang cao", "voice", "doc", "ban hang"] },
  "script-story-narration": { category: "Làm phim", tags: ["loi dan", "ke chuyen", "narration", "doc"] },
};

export const SKILL_LIBRARY: LibSkill[] = [
  // ---------------- ẢNH ----------------
  image("image-review-flatlay", "Review: flat lay đập hộp", "Review sản phẩm", "Ảnh chụp từ trên xuống: sản phẩm, hộp, phụ kiện xếp gọn như bài review.",
    "You are a product reviewer's photographer writing prompts for the Muse image model.",
    ["Top-down flat lay: the product in the centre, its box, manual and accessories arranged in a tidy grid with breathing room.", "Neutral textured surface (linen, light wood, concrete) and soft even daylight, no harsh shadows.", NO_BRAND, "The scene must read as an honest unboxing/review, not an advert."],
    ["review", "danh gia", "dap hop", "unbox", "unboxing", "flat lay", "tren xuong", "phu kien", "mo hop"], 16),
  image("image-review-ugc-hand", "Review: cầm tay kiểu UGC", "Review sản phẩm", "Sản phẩm cầm trên tay, góc điện thoại chân thật như người dùng tự chụp.",
    "You write prompts that look like authentic user-generated review photos for the Muse image model.",
    ["A hand holds the product toward the camera in a real everyday place (desk, kitchen, car, bathroom shelf).", HANDS, "Smartphone photo feel: natural window light, slight depth of field, believable clutter in the background.", NO_BRAND],
    ["review", "cam tay", "tren tay", "ugc", "nguoi dung", "chan that", "feedback", "dung thu", "trai nghiem"], 17),
  image("image-sale-keyvisual", "Bán hàng: key visual khuyến mãi", "Bán hàng", "Ảnh chủ đạo cho bài bán hàng, chừa chỗ trống để chèn chữ sau.",
    "You are an e-commerce art director writing a sales key visual for the Muse image model.",
    ["Bold, high-contrast composition with the product as hero and a clean empty area (top or side) left free for a headline added later — do NOT render any text.", "Energetic but premium: colour-blocked backdrop matching the product colours, dynamic props (ribbons, confetti, light rays) used sparingly.", NO_BRAND],
    ["ban hang", "khuyen mai", "sale", "giam gia", "flash sale", "uu dai", "poster ban hang", "banner", "key visual", "chot don"], 18),
  image("image-ecommerce-white", "Sàn TMĐT: ảnh nền trắng", "Bán hàng", "Ảnh sản phẩm nền trắng chuẩn Shopee/Lazada/TikTok Shop.",
    "You write marketplace catalogue packshots for the Muse image model.",
    ["Pure white seamless background, product centred and filling about 80% of the frame, true colours, crisp edges.", "Soft shadow under the product only, no props, no people.", NO_BRAND],
    ["shopee", "lazada", "tiki", "tiktok shop", "nen trang", "san thuong mai", "ecommerce", "catalog", "anh san pham", "dang ban"], 19),
  image("image-fashion-lookbook", "Thời trang: lookbook đường phố", "Thời trang", "Ảnh toàn thân phối đồ ngoài phố, đúng chất lookbook.",
    "You are a street-style fashion photographer writing prompts for the Muse image model.",
    ["Full-body framing, confident natural pose mid-stride or leaning, outfit layers described piece by piece (garment, fabric, colour, fit, shoes, bag).", "A real city backdrop that complements the outfit colours, shallow depth of field.", "Never a real or famous person; describe by look only."],
    ["lookbook", "phoi do", "outfit", "street style", "duong pho", "toan than", "mac dep", "set do", "thoi trang"], 20),
  image("image-fashion-flatlay", "Thời trang: flat lay set đồ", "Thời trang", "Set quần áo + phụ kiện xếp phẳng từ trên xuống.",
    "You write fashion flat lay prompts for the Muse image model.",
    ["Top-down view of a complete outfit laid out naturally (top, bottom, shoes, bag, accessories) with slight folds to show fabric.", "Clean coordinated background (linen, pastel paper, wood), soft daylight.", NO_BRAND],
    ["flat lay", "set do", "quan ao", "phoi do", "phu kien", "xep phang", "outfit", "tui", "giay"], 21),
  image("image-home-appliance", "Gia dụng: đồ dùng trong nhà", "Gia dụng", "Đồ gia dụng, thiết bị bếp đặt trong căn nhà thật, sạch và ấm.",
    "You write home appliance lifestyle prompts for the Muse image model.",
    ["Place the appliance in a real, tidy home setting where it is used (kitchen counter, laundry corner, living room), at eye level.", "Show one sign of use (steam from a kettle, fresh juice in a blender, folded towels) without clutter.", "Warm natural light, modern Vietnamese apartment feel when relevant.", NO_BRAND],
    ["gia dung", "do dung", "do gia dung", "noi chien", "noi com", "may xay", "am sieu toc", "bep", "nha bep", "may loc", "may hut bui", "quat", "noi", "chao"], 22),
  image("image-home-interior", "Nội thất & decor", "Gia dụng", "Không gian nội thất, đồ decor, phòng ốc đẹp như tạp chí nhà.",
    "You are an interior photographer writing prompts for the Muse image model.",
    ["Wide or three-quarter view of the room with the hero piece clearly placed, straight verticals, balanced composition.", "Natural light from windows, layered textures (wood, linen, ceramic, plants), lived-in but tidy.", "Name the style precisely (Japandi, Indochine, minimal Scandinavian, tropical modern)."],
    ["noi that", "decor", "phong khach", "phong ngu", "can ho", "trang tri", "sofa", "ban ghe", "den", "ke", "interior"], 23),
  image("image-cosmetics", "Mỹ phẩm & làm đẹp", "Làm đẹp", "Skincare, son, kem: texture, giọt nước, ánh sáng trong trẻo.",
    "You are a beauty product photographer writing prompts for the Muse image model.",
    ["Show the product together with its texture (a cream swirl, a serum drop, a lipstick swatch) or fresh ingredients it suggests.", "Clean bright light, glossy reflections, water droplets or a gentle splash used tastefully.", NO_BRAND],
    ["my pham", "skincare", "duong da", "serum", "kem", "son", "trang diem", "lam dep", "beauty", "nuoc hoa", "sua rua mat", "toner"], 24),
  image("image-tech-gadget", "Công nghệ & thiết bị", "Công nghệ", "Điện thoại, tai nghe, đồng hồ thông minh: tối, sắc, ánh sáng viền.",
    "You are a tech product photographer writing prompts for the Muse image model.",
    ["Dark or gradient background, precise rim lights tracing edges, subtle reflections on a glossy surface.", "Screens show abstract colourful light, never readable UI or text.", NO_BRAND],
    ["cong nghe", "dien thoai", "tai nghe", "dong ho thong minh", "laptop", "may tinh", "loa", "gadget", "phu kien cong nghe", "sac", "ban phim", "chuot"], 25),
  image("image-jewelry", "Trang sức & phụ kiện", "Thời trang", "Nhẫn, dây chuyền, đồng hồ: macro lấp lánh, nền sang.",
    "You are a jewellery photographer writing prompts for the Muse image model.",
    ["Macro framing, sharp facets with controlled sparkle highlights, rich backdrop (velvet, silk, stone).", "One piece or a small set only; elegant negative space."],
    ["trang suc", "nhan", "day chuyen", "bong tai", "lac tay", "vang", "bac", "kim cuong", "dong ho", "jewelry"], 26),
  image("image-kids-toys", "Mẹ & bé, đồ chơi", "Mẹ & bé", "Đồ chơi, đồ cho bé: màu pastel, an toàn, ấm áp.",
    "You write prompts for baby and toy products for the Muse image model.",
    ["Soft pastel palette, rounded shapes, safe cosy setting (nursery, play mat).", "If a child appears: happy, natural, fully clothed, never posed suggestively, face partly turned or softly focused.", NO_BRAND],
    ["me va be", "em be", "tre em", "do choi", "bim", "binh sua", "xe day", "be", "baby", "kid"], 27),
  image("image-pet", "Thú cưng", "Thú cưng", "Chó mèo đáng yêu, đồ cho thú cưng, khoảnh khắc tự nhiên.",
    "You write pet photography prompts for the Muse image model.",
    ["Eye-level with the animal, catchlight in the eyes, fur texture visible; name the breed and colours precisely.", "A candid moment (tilting head, playing, napping) in a homely place."],
    ["thu cung", "cho", "meo", "cun", "pet", "thuc an cho", "do choi cho cho", "cat", "dog"], 28),
  image("image-real-estate", "Bất động sản", "Bất động sản", "Ngoại thất, căn hộ mẫu, dự án: góc rộng, sáng, sạch.",
    "You are an architectural photographer writing prompts for the Muse image model.",
    ["Wide-angle, straight verticals, golden hour or soft daylight; show the building or room at its best angle.", "Landscaping and sky make it inviting; no people or few distant figures."],
    ["bat dong san", "can ho", "nha pho", "biet thu", "du an", "chung cu", "dat nen", "nha mau", "kien truc", "resort"], 29),
  image("image-poster-concept", "Poster & concept art", "Làm phim", "Key art điện ảnh/game: bố cục kịch tính, không chữ.",
    "You are a key-art designer writing concept poster prompts for the Muse image model.",
    ["Iconic, dramatic composition (strong silhouette, scale contrast, leading lines) with a clear focal point.", "Painterly or cinematic finish depending on the style; leave space for a title but render no text."],
    ["poster", "concept", "key art", "bia phim", "game", "fantasy", "sci fi", "minh hoa", "artwork"], 30),
  image("image-youtube-thumbnail", "Thumbnail YouTube / vlog", "Vlog", "Ảnh bìa vlog: chủ thể to, cảm xúc rõ, tương phản cao, chừa chỗ tiêu đề.",
    "You design YouTube/TikTok cover images for the Muse image model.",
    ["One big expressive subject (face with clear emotion or the key object) on one side, simple bold background on the other side left free for a title — render no text.", "High contrast, saturated but natural colours, crisp edges readable at small size."],
    ["thumbnail", "anh bia", "youtube", "tiktok", "bia video", "vlog", "cover"], 31),
  image("image-vlog-moment", "Vlog: khoảnh khắc đời thường", "Vlog", "Ảnh đời thường tự nhiên như khung hình vlog: cà phê, đi dạo, làm việc.",
    "You write candid lifestyle vlog frame prompts for the Muse image model.",
    ["Candid, unposed moment from a creator's day, slightly wide lens, natural light, real places.", "Warm, honest colour grade; small imperfections are welcome."],
    ["vlog", "doi thuong", "mot ngay", "daily", "song cham", "khoanh khac", "lifestyle", "di dao"], 32),
  image("image-event-wedding", "Sự kiện & cưới", "Sự kiện", "Tiệc cưới, sự kiện, trang trí: lãng mạn, lung linh.",
    "You write event and wedding photography prompts for the Muse image model.",
    ["Decor details or a couple moment with soft bokeh lights, flowers and warm tones.", "Elegant composition, emotion over posing; traditional Vietnamese elements (ao dai, red-gold decor) when mentioned."],
    ["dam cuoi", "cuoi", "su kien", "tiec", "sinh nhat", "khai truong", "trang tri", "wedding", "le", "hoi nghi"], 33),
  image("image-sport-fitness", "Thể thao & fitness", "Thể thao", "Tập luyện, đồ thể thao: năng lượng, cơ bắp, ánh sáng gắt đẹp.",
    "You write sport and fitness prompts for the Muse image model.",
    ["Peak-action moment frozen (jump, sprint, lift) with sweat and muscle definition, dramatic side light.", "Gym, track or outdoor setting; gear described precisely."],
    ["the thao", "fitness", "gym", "tap luyen", "chay bo", "yoga", "bong da", "do the thao", "giay chay"], 34),
  image("image-illustration-edu", "Minh họa & giáo dục", "Giáo dục", "Hình minh họa phẳng/3D dễ hiểu cho bài học, khóa học.",
    "You write clean explanatory illustration prompts for the Muse image model.",
    ["Clear simple scene that explains one idea visually, flat or soft 3D illustration, friendly characters.", "Limited palette, generous whitespace, no text or labels."],
    ["minh hoa", "giao duc", "bai hoc", "khoa hoc", "hoc sinh", "infographic", "giai thich", "illustration"], 35),

  // ---------------- VIDEO ----------------
  video("video-review-unbox", "Review: đập hộp", "Review sản phẩm", "Tay mở hộp, lấy sản phẩm ra, góc trên xuống như video review.",
    "You write unboxing shots for the Muse video model.",
    ["Top-down or 45° view of a desk; two hands open the box lid and lift the product out in one continuous motion.", HANDS, NO_BRAND, "Prefer a static locked-off camera or a slow push-in."],
    ["review", "dap hop", "unbox", "unboxing", "mo hop", "dung thu", "danh gia"], 40),
  video("video-review-demo", "Review: dùng thử thực tế", "Review sản phẩm", "Sản phẩm đang được dùng, thấy rõ công dụng.",
    "You write product-in-use demo shots for the Muse video model.",
    ["Show the product doing its job in a real place (a blender blending, a lamp turning on, cream absorbing into skin) with a clear visible result.", HANDS, NO_BRAND, "No before/after split screen; one continuous action."],
    ["review", "dung thu", "demo", "cong dung", "trai nghiem", "su dung", "test", "kiem tra"], 41),
  video("video-sale-hook", "Bán hàng: hook 3 giây", "Bán hàng", "Cảnh mở đầu gây dừng lướt cho quảng cáo TikTok/Reels.",
    "You write scroll-stopping opening shots for short-form ads on the Muse video model.",
    ["The first second already moves: a dramatic reveal, a splash, an unexpected scale or a satisfying motion around the product.", "Bold colours and strong contrast, product clearly visible by the end of the shot.", NO_BRAND],
    ["hook", "dung luot", "tiktok", "reels", "quang cao", "ads", "ban hang", "viral", "chot don", "mo dau"], 42),
  video("video-sale-ugc-broll", "Bán hàng: b-roll kiểu UGC", "Bán hàng", "Cảnh cầm máy tự nhiên như người thật dùng sản phẩm.",
    "You write authentic UGC-style b-roll for the Muse video model.",
    ["Handheld phone feel with gentle natural sway, everyday location, a real person using the product casually.", "No talking to camera, no lip-sync, no text.", HANDS, NO_BRAND],
    ["ugc", "nguoi that", "review", "feedback", "kol", "koc", "affiliate", "tiep thi lien ket", "ban hang"], 43),
  video("video-ecommerce-360", "Sàn TMĐT: xoay 360", "Bán hàng", "Sản phẩm xoay trên bàn xoay, nền sạch, cho trang sản phẩm.",
    "You write turntable product spins for the Muse video model.",
    ["The product rotates slowly on a hidden turntable against a clean seamless background; camera stays locked off.", "Even soft light so every side looks true to colour.", NO_BRAND],
    ["xoay 360", "ban xoay", "shopee", "lazada", "tiktok shop", "san pham", "nen trang", "ecommerce", "catalog"], 44),
  video("video-home-appliance", "Gia dụng: thiết bị hoạt động", "Gia dụng", "Nồi chiên, máy xay, máy lọc… đang chạy trong căn bếp thật.",
    "You write home appliance demo shots for the Muse video model.",
    ["The appliance is switched on and visibly working (food crisping, juice swirling, steam rising, water flowing) in a tidy real home.", "Warm kitchen light, slow push-in or locked-off camera.", NO_BRAND],
    ["gia dung", "noi chien", "noi com", "may xay", "am sieu toc", "bep", "may loc", "may hut bui", "quat", "may giat", "do dung"], 45),
  video("video-cleaning-satisfying", "Gia dụng: làm sạch thỏa mãn", "Gia dụng", "Cảnh lau chùi, dọn dẹp 'satisfying' trước – sau trong một cú máy.",
    "You write satisfying cleaning/organising shots for the Muse video model.",
    ["One continuous satisfying action: a cloth wipes a stain away, a spray foams and rinses, items slide into a perfectly organised drawer.", "Close framing, crisp detail, calm pace, locked-off or very slow push-in.", NO_BRAND],
    ["ve sinh", "lau chui", "don dep", "tay rua", "sach", "satisfying", "sap xep", "nuoc lau", "khu mui"], 46),
  video("video-cosmetics-texture", "Mỹ phẩm: texture & giọt nước", "Làm đẹp", "Kem xoáy, serum nhỏ giọt, son lướt: chậm, sang.",
    "You write beauty texture shots for the Muse video model.",
    ["Macro slow-motion texture: a cream swirl folding, a serum drop falling and spreading, water rippling around the bottle.", "Bright clean light, glossy highlights moving across the surface.", NO_BRAND],
    ["my pham", "skincare", "serum", "kem", "son", "texture", "lam dep", "duong da", "nuoc hoa", "beauty"], 47),
  video("video-tech-reveal", "Công nghệ: reveal thiết bị", "Công nghệ", "Thiết bị hiện ra trong bóng tối với ánh sáng quét viền.",
    "You write tech product reveal shots for the Muse video model.",
    ["Dark scene where a light sweep travels along the device edges revealing its shape; the screen glows with abstract colour (no UI, no text).", "Slow orbit or slow push-in.", NO_BRAND],
    ["cong nghe", "dien thoai", "tai nghe", "laptop", "dong ho thong minh", "loa", "gadget", "ra mat", "reveal"], 48),
  video("video-jewelry-sparkle", "Trang sức lấp lánh", "Thời trang", "Trang sức xoay nhẹ dưới ánh sáng, lấp lánh từng mặt cắt.",
    "You write jewellery shots for the Muse video model.",
    ["Macro: the piece turns slightly or the light moves so facets sparkle in sequence; velvet or silk backdrop.", "Very slow orbit or locked-off camera."],
    ["trang suc", "nhan", "day chuyen", "bong tai", "vang", "bac", "kim cuong", "lap lanh", "jewelry"], 49),
  video("video-film-establishing", "Làm phim: cảnh mở bối cảnh", "Làm phim", "Cảnh rộng giới thiệu bối cảnh, không khí phim.",
    "You are a film director writing establishing shots for the Muse video model.",
    ["Wide shot that sets place, time and mood; living details (smoke from chimneys, traffic far away, birds, weather).", "Slow aerial glide, slow crane up or slow pan; cinematic colour grade."],
    ["lam phim", "phim ngan", "canh mo dau", "boi canh", "establishing", "dien anh", "intro", "toan canh"], 50),
  video("video-film-emotion", "Làm phim: khoảnh khắc cảm xúc", "Làm phim", "Nhân vật trong một nhịp cảm xúc: nhìn xa, mỉm cười, rơi nước mắt.",
    "You are a film director writing an emotional character beat for the Muse video model.",
    ["One small, readable emotion with a beginning and end (a hesitant smile, eyes filling with tears, a long look out of a rainy window).", "No dialogue, no lip-sync; motivated light (window, lamp, neon) and shallow depth of field.", "Slow push-in or locked-off camera."],
    ["cam xuc", "phim", "nhan vat", "buon", "vui", "ky niem", "tinh cam", "drama", "chia tay", "gap lai"], 51),
  video("video-film-action", "Làm phim: nhịp hành động", "Làm phim", "Cảnh hành động có lực nhưng vẫn một chuyển động máy mượt.",
    "You are an action director writing a single dynamic shot for the Muse video model.",
    ["One strong physical action (a leap across rooftops, a motorbike skidding through rain, a sword draw) with clear direction of movement.", "Camera tracks with the action in one smooth move — no shake, no cuts, no speed ramps."],
    ["hanh dong", "action", "doi khang", "ruot duoi", "chien dau", "phim hanh dong", "kich tinh"], 52),
  video("video-vlog-daily", "Vlog: một ngày của tôi", "Vlog", "Cảnh đời thường góc nhìn người quay: pha cà phê, đi phố, làm việc.",
    "You write daily-life vlog b-roll for the Muse video model.",
    ["First-person or close third-person view of a small daily ritual (pouring coffee, opening curtains, walking down a street).", "Natural light, warm honest grade, gentle handheld follow or locked-off."],
    ["vlog", "mot ngay", "daily", "doi thuong", "song cham", "buoi sang", "lam viec", "pov"], 53),
  video("video-vlog-food-tour", "Vlog: food tour đường phố", "Vlog", "Ăn uống vỉa hè, chợ đêm, quán nhỏ — sống động và gần gũi.",
    "You write street-food vlog shots for the Muse video model.",
    ["Lively street-food scene: vendor cooking, steam and fire, customers on small plastic stools, neon or lantern light.", "Handheld follow at walking pace or slow lateral tracking; authentic Vietnamese details."],
    ["food tour", "an vat", "via he", "cho dem", "quan an", "duong pho", "an uong", "review quan"], 54),
  video("video-real-estate-tour", "Bất động sản: dẫn tour", "Bất động sản", "Lướt qua căn hộ, nhà mẫu, khuôn viên dự án.",
    "You write property walkthrough shots for the Muse video model.",
    ["A smooth gimbal glide through the space from one room into the next or along the facade at golden hour.", "Bright, airy, tidy; light through windows, curtains moving slightly."],
    ["bat dong san", "can ho", "nha mau", "du an", "biet thu", "chung cu", "tour", "kien truc"], 55),
  video("video-cinemagraph-loop", "Nền lặp (loop) tinh tế", "Chung", "Cảnh gần như tĩnh, chỉ một chi tiết chuyển động — làm nền, màn hình chờ.",
    "You write seamless subtle loop backgrounds for the Muse video model.",
    ["Almost still scene where only one element moves continuously (steam, water, curtains, flickering candle, drifting clouds) so the clip loops naturally.", "Locked-off camera, calm and balanced composition."],
    ["loop", "lap", "nen dong", "cinemagraph", "background", "man hinh cho", "thu gian"], 56),
  video("video-pets-kids", "Thú cưng & em bé đáng yêu", "Thú cưng", "Chó mèo, em bé với khoảnh khắc dễ thương tự nhiên.",
    "You write cute pet and baby moment shots for the Muse video model.",
    ["One adorable natural action (a kitten pouncing on a ribbon, a puppy tilting its head, a baby reaching for a toy).", "Soft warm light, eye-level camera, slow push-in or locked-off; babies always safe and fully clothed."],
    ["thu cung", "cho", "meo", "cun", "em be", "de thuong", "cute", "pet", "baby"], 57),

  // ---------------- STORY ----------------
  story("story-product-review", "Kịch bản review sản phẩm", "Review sản phẩm", "Hook → mở hộp → dùng thử → kết quả → cảnh chốt.",
    "You are a reviewer-creator planning a product review video for the Muse video model.",
    ["Arc: visual hook, unboxing, close look at details, the product in real use with a visible result, final hero shot.", "Keep the product described with the same exact phrase in every shot.", NO_BRAND],
    ["review", "danh gia", "dap hop", "trai nghiem", "dung thu"], 34),
  story("story-vlog-day", "Kịch bản vlog một ngày", "Vlog", "Sáng → trưa → chiều → tối, các cảnh nối bằng chuyển động.",
    "You are a lifestyle vlogger planning a 'day in my life' video for the Muse video model.",
    ["Shots follow the time of day with light changing naturally; each shot ends on a movement that the next continues (door opening, walking, pouring).", "Keep the creator described identically in every shot."],
    ["vlog", "mot ngay", "daily", "doi thuong", "du lich"], 35),
  story("story-short-film", "Kịch bản phim ngắn 3 hồi", "Làm phim", "Mở → xung đột → giải quyết, nhân vật khóa mô tả.",
    "You are a short-film director planning a three-act micro film for the Muse video model.",
    ["Act 1 sets the character and place, act 2 brings a small conflict, the last shot resolves it with an emotional image.", "Lock the main character in Muse vocabulary and repeat it word for word; one location family and colour palette."],
    ["phim ngan", "lam phim", "cau chuyen", "kich ban", "dien anh", "short film"], 36),

  // ---------------- LỜI THOẠI ----------------
  script("script-sales-livestream", "Lời bán hàng / livestream", "Bán hàng", "Lời chốt đơn tự nhiên, nêu lợi ích, kêu gọi mua.",
    ["Bạn là người bán hàng livestream giỏi, nói tiếng Việt tự nhiên, gần gũi.", "- 4 đến 6 câu, mỗi câu tối đa 20 chữ: câu mở thu hút, 2–3 câu lợi ích cụ thể từ ý tưởng, câu cuối kêu gọi.", "- Không bịa giá, khuyến mãi, cam kết hay công dụng y tế nếu ý tưởng không nói.", "- Không emoji, không ký hiệu lạ."],
    ["ban hang", "livestream", "chot don", "loi ban", "sale", "quang cao"], 42),
  script("script-review-honest", "Lời review chân thật", "Review sản phẩm", "Lời review như người dùng thật: ưu, nhược, kết luận.",
    ["Bạn là người review sản phẩm trung thực, giọng tự nhiên như kể với bạn bè.", "- 4 đến 6 câu: ấn tượng đầu, 2 điểm thích, 1 điểm cần lưu ý, kết luận nên mua cho ai.", "- Chỉ dựa trên thông tin trong ý tưởng, không bịa thông số.", "- Không emoji."],
    ["review", "danh gia", "nhan xet", "trai nghiem", "uu nhuoc diem"], 43),
];
