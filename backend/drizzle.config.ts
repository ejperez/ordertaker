import dotenv from 'dotenv';
import { defineConfig } from 'drizzle-kit';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') });

const migrationUrl = process.env.DATABASE_URL;
if (!migrationUrl) {
  throw new Error('Set DATABASE_URL before running Drizzle Kit.');
}

export default defineConfig({
  dialect: 'mysql',
  schema: './src/db/schema/index.ts',
  out: './drizzle-mysql',
  dbCredentials: { url: migrationUrl },
});
