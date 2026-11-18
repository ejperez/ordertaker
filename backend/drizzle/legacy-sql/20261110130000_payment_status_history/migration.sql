CREATE TYPE "PaymentActorType" AS ENUM ('CUSTOMER', 'OWNER', 'SYSTEM');

CREATE TABLE "payment_status_histories" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "old_status" "PaymentStatus",
    "new_status" "PaymentStatus" NOT NULL,
    "actor_type" "PaymentActorType" NOT NULL,
    "changed_by_user_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_status_histories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payment_status_histories_payment_id_created_at_idx"
    ON "payment_status_histories"("payment_id", "created_at");

ALTER TABLE "payment_status_histories"
    ADD CONSTRAINT "payment_status_histories_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "payments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_status_histories"
    ADD CONSTRAINT "payment_status_histories_changed_by_user_id_fkey"
    FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
