ALTER TABLE "orders" ADD COLUMN "idempotency_key_hash" TEXT;

CREATE UNIQUE INDEX "orders_idempotency_key_hash_key" ON "orders"("idempotency_key_hash");
