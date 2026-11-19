import fastifyStatic from '@fastify/static';
import { extname, resolve } from 'node:path';
export const frontendPlugin = async (app, { root = resolve(import.meta.dirname, '../../../../frontend/dist') }) => {
    await app.register(fastifyStatic, { root, prefix: '/' });
    app.setNotFoundHandler((request, reply) => {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        if (request.method !== 'GET' ||
            pathname === '/api' ||
            pathname.startsWith('/api/') ||
            extname(pathname)) {
            return reply.code(404).send({ error: 'Not Found' });
        }
        return reply.type('text/html').sendFile('index.html');
    });
};
