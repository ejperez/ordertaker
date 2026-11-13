import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

const envSchema = z
  .object({
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DIRECT_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    SUPABASE_URL: z.string(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    SUPABASE_PRODUCT_BUCKET: z.string().default('product-images'),
    SUPABASE_PAYMENT_PROOFS_BUCKET: z.string().default('payment-proofs'),
    API_HOST: z.string().default('0.0.0.0'),
    API_PORT: z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      .default(Number(process.env.PORT ?? 3000)),
    FRONTEND_ORIGIN: z.string().url().default('http://localhost:5173'),
  })
  .superRefine((config, context) => {
    if (config.SUPABASE_PRODUCT_BUCKET === config.SUPABASE_PAYMENT_PROOFS_BUCKET) {
      context.addIssue({
        code: 'custom',
        path: ['SUPABASE_PAYMENT_PROOFS_BUCKET'],
        message: 'SUPABASE_PAYMENT_PROOFS_BUCKET must be separate from the public product bucket',
      });
    }
    if (
      process.env.NODE_ENV === 'production' &&
      new URL(config.FRONTEND_ORIGIN).protocol !== 'https:'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['FRONTEND_ORIGIN'],
        message: 'FRONTEND_ORIGIN must use HTTPS in production',
      });
    }
    if (
      process.env.NODE_ENV === 'production' &&
      new URL(config.SUPABASE_URL).protocol !== 'https:'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['SUPABASE_URL'],
        message: 'SUPABASE_URL must use HTTPS in production',
      });
    }
  });

export const env = envSchema.parse(process.env);
