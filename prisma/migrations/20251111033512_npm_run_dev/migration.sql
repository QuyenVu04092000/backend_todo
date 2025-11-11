-- CreateEnum
CREATE TYPE "TodoStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE');

-- AlterTable
ALTER TABLE "Todo" ADD COLUMN     "status" "TodoStatus" NOT NULL DEFAULT 'TODO';
