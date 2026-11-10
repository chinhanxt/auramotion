-- CreateEnum
CREATE TYPE "SkillKind" AS ENUM ('IMAGE', 'VIDEO', 'STORY', 'SCRIPT');

-- CreateEnum
CREATE TYPE "StoryMode" AS ENUM ('PARALLEL', 'CHAIN');

-- CreateEnum
CREATE TYPE "StoryStatus" AS ENUM ('PLANNING', 'READY', 'RENDERING', 'ASSEMBLING', 'DONE', 'FAILED', 'CANCELED');

-- AlterTable
ALTER TABLE "credit_transactions" ADD COLUMN     "storyId" TEXT;

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "progress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "queuedAt" TIMESTAMP(3),
ADD COLUMN     "shotIndex" INTEGER,
ADD COLUMN     "storyId" TEXT;

-- AlterTable
ALTER TABLE "presets" ADD COLUMN     "category" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "cover" TEXT,
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "palette" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "sort" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "prompt_skills" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SkillKind" NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "instructions" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "minPlanRank" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stories" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "idea" TEXT NOT NULL,
    "skillId" TEXT,
    "styleId" TEXT,
    "cameraId" TEXT,
    "aspect" TEXT NOT NULL,
    "shotCount" INTEGER NOT NULL,
    "shotDurationSec" INTEGER NOT NULL,
    "mode" "StoryMode" NOT NULL DEFAULT 'PARALLEL',
    "autoRun" BOOLEAN NOT NULL DEFAULT false,
    "autoAssemble" BOOLEAN NOT NULL DEFAULT false,
    "assemble" JSONB NOT NULL DEFAULT '{}',
    "status" "StoryStatus" NOT NULL DEFAULT 'PLANNING',
    "plan" JSONB NOT NULL DEFAULT '{}',
    "threadKey" TEXT NOT NULL,
    "planner" TEXT NOT NULL,
    "planCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "error" TEXT,
    "finalJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "stories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prompt_skills_slug_key" ON "prompt_skills"("slug");

-- CreateIndex
CREATE INDEX "stories_userId_idx" ON "stories"("userId");

-- CreateIndex
CREATE INDEX "stories_status_idx" ON "stories"("status");

-- CreateIndex
CREATE INDEX "credit_transactions_storyId_idx" ON "credit_transactions"("storyId");

-- CreateIndex
CREATE INDEX "jobs_storyId_idx" ON "jobs"("storyId");

-- CreateIndex
CREATE INDEX "jobs_featured_idx" ON "jobs"("featured");

-- CreateIndex
CREATE UNIQUE INDEX "presets_slug_key" ON "presets"("slug");

-- AddForeignKey
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Job cũ đều đã vào hàng đợi lúc tạo.
UPDATE "jobs" SET "queuedAt" = "createdAt" WHERE "queuedAt" IS NULL;
