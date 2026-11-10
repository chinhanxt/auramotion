-- Model catalog v2: người dùng chọn theo tên model (nhóm theo hãng), admin đồng bộ + test vẽ.
ALTER TABLE "models" ADD COLUMN "vendor" TEXT NOT NULL DEFAULT '',
ADD COLUMN "displayName" TEXT NOT NULL DEFAULT '',
ADD COLUMN "badge" TEXT NOT NULL DEFAULT '',
ADD COLUMN "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN "etaSec" INTEGER,
ADD COLUMN "verified" JSONB,
ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';

-- Dòng cũ (seed v1): điền hãng + tên đẹp; Codex Ảnh ghim gpt-6.1-sol (trước để trống = model mặc định của CLI).
UPDATE "models" SET "engineModel" = 'gpt-6.1-sol' WHERE "name" = 'Codex Ảnh' AND "engineModel" = '';
UPDATE "models" SET "vendor" = 'muse', "displayName" = 'Muse Image' WHERE "name" = 'MUSE Ảnh' AND "displayName" = '';
UPDATE "models" SET "vendor" = 'muse', "displayName" = 'Muse Image · TK2' WHERE "name" = 'MUSE Ảnh 2' AND "displayName" = '';
UPDATE "models" SET "vendor" = 'google', "displayName" = 'Gemini 3.8 Flash · Medium' WHERE "name" = 'Gemini Ảnh' AND "displayName" = '';
UPDATE "models" SET "vendor" = 'openai', "displayName" = 'GPT-6.1 Sol' WHERE "name" = 'Codex Ảnh' AND "displayName" = '';
UPDATE "models" SET "vendor" = 'muse', "displayName" = 'Muse Video' WHERE "name" = 'MUSE Video' AND "displayName" = '';
UPDATE "models" SET "vendor" = 'local', "displayName" = 'Ghép video' WHERE "name" = 'Ghép video' AND "displayName" = '';
UPDATE "models" SET "vendor" = CASE "provider" WHEN 'MUSE' THEN 'muse' WHEN 'CODEX' THEN 'openai' WHEN 'LOCAL' THEN 'local'
  ELSE CASE WHEN "engineModel" LIKE 'claude%' THEN 'anthropic' ELSE 'google' END END
WHERE "vendor" = '';

-- 7 model ảnh đã test vẽ thật (10/11/2026). Chỉ chạy trên DB đã có dữ liệu (DB mới: prisma/seed.ts tạo).
-- Cùng provider + engineModel + kind đã có dòng (vd Codex Ảnh = gpt-6.1-sol) thì dùng lại dòng đó.
CREATE TEMP TABLE "_catalog_seed" ("name" TEXT, "provider" "ModelProvider", "engineModel" TEXT, "vendor" TEXT, "displayName" TEXT,
  "badge" TEXT, "minPlanRank" INTEGER, "baseCost" DECIMAL(12,2), "sort" INTEGER, "ms" INTEGER);
INSERT INTO "_catalog_seed" VALUES
  ('agy:gemini-3.8-flash-low:IMAGE', 'AGY', 'gemini-3.8-flash-low', 'google', 'Gemini 3.8 Flash', 'Nhanh', 0, 1, 1, 24000),
  ('agy:gemini-4-argon-low:IMAGE', 'AGY', 'gemini-4-argon-low', 'google', 'Gemini 4 Argon', 'Mới', 0, 1, 3, 33000),
  ('agy:claude-sonnet-5-5-low:IMAGE', 'AGY', 'claude-sonnet-5-5-low', 'anthropic', 'Claude Sonnet 5.5', '', 0, 1, 1, 21000),
  ('agy:claude-opus-5-5-low:IMAGE', 'AGY', 'claude-opus-5-5-low', 'anthropic', 'Claude Opus 5.5', 'Đẹp', 0, 1, 2, 20000),
  ('codex:gpt-6-luna:IMAGE', 'CODEX', 'gpt-6-luna', 'openai', 'GPT-6 Luna', '', 1, 2, 1, 42000),
  ('codex:gpt-6.1-sol:IMAGE', 'CODEX', 'gpt-6.1-sol', 'openai', 'GPT-6.1 Sol', 'Pro', 1, 2, 3, 44000),
  ('codex:gpt-6-astra:IMAGE', 'CODEX', 'gpt-6-astra', 'openai', 'GPT-6 Astra', '', 1, 2, 2, 30000);

UPDATE "models" m SET
  "verified" = COALESCE(m."verified", jsonb_build_object('ok', true, 'testedAt', '2026-11-10T16:00:00+07:00', 'ms', c."ms")),
  "etaSec" = COALESCE(m."etaSec", c."ms" / 1000),
  "badge" = CASE WHEN m."badge" = '' THEN c."badge" ELSE m."badge" END,
  "vendor" = CASE WHEN m."vendor" = '' THEN c."vendor" ELSE m."vendor" END,
  "displayName" = CASE WHEN m."displayName" = '' THEN c."displayName" ELSE m."displayName" END
FROM "_catalog_seed" c
WHERE m."provider" = c."provider" AND m."engineModel" = c."engineModel" AND m."kind" = 'IMAGE';

INSERT INTO "models" ("id", "name", "provider", "engineModel", "kind", "minPlanRank", "baseCost", "options", "enabled", "sort",
  "vendor", "displayName", "badge", "etaSec", "verified", "source")
SELECT 'mdl_' || substr(md5(c."name"), 1, 21), c."name", c."provider", c."engineModel", 'IMAGE', c."minPlanRank", c."baseCost",
  '{"aspectRatios":["1:1","9:16","16:9","4:5"],"counts":[1],"maxRefs":1}'::jsonb, true, c."sort",
  c."vendor", c."displayName", c."badge", c."ms" / 1000,
  jsonb_build_object('ok', true, 'testedAt', '2026-11-10T16:00:00+07:00', 'ms', c."ms"), 'manual'
FROM "_catalog_seed" c
WHERE EXISTS (SELECT 1 FROM "models")
  AND NOT EXISTS (SELECT 1 FROM "models" m WHERE m."provider" = c."provider" AND m."engineModel" = c."engineModel" AND m."kind" = 'IMAGE')
ON CONFLICT ("name") DO NOTHING;

DROP TABLE "_catalog_seed";
