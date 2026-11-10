-- Thêm 5 model codex đã test vẽ thật 10/11/2026 (profile default). Chỉ chạy trên DB đã có dữ liệu (DB mới: prisma/seed.ts).
CREATE TEMP TABLE "_catalog_seed" ("name" TEXT, "engineModel" TEXT, "displayName" TEXT, "sort" INTEGER, "ms" INTEGER);
INSERT INTO "_catalog_seed" VALUES
  ('codex:gpt-6-sol:IMAGE', 'gpt-6-sol', 'GPT-6 Sol', 4, 29000),
  ('codex:gpt-6.1-terra:IMAGE', 'gpt-6.1-terra', 'GPT-6.1 Terra', 5, 32000),
  ('codex:gpt-5.6-sol:IMAGE', 'gpt-5.6-sol', 'GPT-5.6 Sol', 6, 37000),
  ('codex:gpt-5.6-terra:IMAGE', 'gpt-5.6-terra', 'GPT-5.6 Terra', 7, 33000),
  ('codex:gpt-5.6-luna:IMAGE', 'gpt-5.6-luna', 'GPT-5.6 Luna', 8, 29000);

UPDATE "models" m SET
  "verified" = COALESCE(m."verified", jsonb_build_object('ok', true, 'testedAt', '2026-11-10T16:00:00+07:00', 'ms', c."ms")),
  "etaSec" = COALESCE(m."etaSec", c."ms" / 1000),
  "vendor" = CASE WHEN m."vendor" = '' THEN 'openai' ELSE m."vendor" END,
  "displayName" = CASE WHEN m."displayName" = '' THEN c."displayName" ELSE m."displayName" END
FROM "_catalog_seed" c
WHERE m."provider" = 'CODEX' AND m."engineModel" = c."engineModel" AND m."kind" = 'IMAGE';

INSERT INTO "models" ("id", "name", "provider", "engineModel", "kind", "minPlanRank", "baseCost", "options", "enabled", "sort",
  "vendor", "displayName", "badge", "etaSec", "verified", "source")
SELECT 'mdl_' || substr(md5(c."name"), 1, 21), c."name", 'CODEX', c."engineModel", 'IMAGE', 1, 2,
  '{"aspectRatios":["1:1","9:16","16:9","4:5"],"counts":[1],"maxRefs":1}'::jsonb, true, c."sort",
  'openai', c."displayName", '', c."ms" / 1000,
  jsonb_build_object('ok', true, 'testedAt', '2026-11-10T16:00:00+07:00', 'ms', c."ms"), 'manual'
FROM "_catalog_seed" c
WHERE EXISTS (SELECT 1 FROM "models")
  AND NOT EXISTS (SELECT 1 FROM "models" m WHERE m."provider" = 'CODEX' AND m."engineModel" = c."engineModel" AND m."kind" = 'IMAGE')
ON CONFLICT ("name") DO NOTHING;

DROP TABLE "_catalog_seed";
