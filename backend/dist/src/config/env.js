import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });
const envSchema = z
    .object({
    DATABASE_URL: z.url({ protocol: /^mysql$/ }),
    UPLOADS_DIR: z
        .string()
        .min(1)
        .transform((directory) => resolve(directory))
        .default(resolve(process.cwd(), 'uploads')),
    API_PUBLIC_ORIGIN: z.url().optional(),
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
    if (process.env.NODE_ENV === 'production' &&
        new URL(config.FRONTEND_ORIGIN).protocol !== 'https:') {
        context.addIssue({
            code: 'custom',
            path: ['FRONTEND_ORIGIN'],
            message: 'FRONTEND_ORIGIN must use HTTPS in production',
        });
    }
    if (process.env.NODE_ENV === 'production' &&
        config.API_PUBLIC_ORIGIN &&
        new URL(config.API_PUBLIC_ORIGIN).protocol !== 'https:') {
        context.addIssue({
            code: 'custom',
            path: ['API_PUBLIC_ORIGIN'],
            message: 'API_PUBLIC_ORIGIN must use HTTPS in production',
        });
    }
});
const config = envSchema.parse(process.env);
export const env = {
    ...config,
    API_PUBLIC_ORIGIN: config.API_PUBLIC_ORIGIN ??
        (process.env.NODE_ENV === 'production'
            ? config.FRONTEND_ORIGIN
            : `http://localhost:${config.API_PORT}`),
};
