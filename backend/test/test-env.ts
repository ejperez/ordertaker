process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/ordertaker_test?schema=public';
process.env.FRONTEND_ORIGIN ??= 'http://localhost:5173';
process.env.NODE_ENV = 'test';
