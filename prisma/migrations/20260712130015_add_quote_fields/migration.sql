-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "quote_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "quote_fee_paid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "quote_type" TEXT NOT NULL DEFAULT 'free';
