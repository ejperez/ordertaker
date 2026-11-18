process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/ordertaker_test?schema=public';
process.env.DIRECT_URL ??= 'postgresql://test:test@127.0.0.1:5432/ordertaker_test?schema=public';
process.env.SUPABASE_URL ??= 'https://test-project.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';
process.env.FRONTEND_ORIGIN ??= 'http://localhost:5173';
process.env.NODE_ENV = 'test';
