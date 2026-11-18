import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: resolve(import.meta.dirname, '../../.env') });

if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Set TEST_DATABASE_URL to a disposable MySQL database ending in _test');
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.UPLOADS_DIR = join(tmpdir(), `ordertaker-test-${randomUUID()}`);
process.env.FRONTEND_ORIGIN ??= 'http://localhost:5173';
process.env.NODE_ENV = 'test';
