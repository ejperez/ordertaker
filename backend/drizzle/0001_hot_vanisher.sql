DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.order_items'::regclass
      AND confrelid = 'public.products'::regclass
      AND contype = 'f'
  ) THEN
    ALTER TABLE "order_items"
      ADD CONSTRAINT "order_items_product_id_products_id_fk"
      FOREIGN KEY ("product_id")
      REFERENCES "public"."products"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END
$$;