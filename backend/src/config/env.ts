import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

const envSchema = z
  .object({
    DATABASE_URL: z.string().url(),
    API_HOST: z.string().default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    FRONTEND_ORIGIN: z.string().url().default('http://localhost:5173'),
  })
  .superRefine((config, context) => {
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
  });

export const env = envSchema.parse(process.env);
