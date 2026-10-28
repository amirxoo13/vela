import Fastify from 'fastify';
import cors from '@fastify/cors';
import { closeAccounts, openAccounts } from '../lib/accounts.mjs';
import { config, getToken } from './config.js';
import { ApiError } from './errors.js';
import { registerRoutes } from './routes.js';

const app = Fastify({
  logger: {
    level: config.logLevel,
    // Never log request headers, bodies, or anything that could contain secrets.
    serializers: {
      req: (r) => ({ method: r.method, url: r.url.split('?')[0], range: r.headers?.range }),
      res: (r) => ({ statusCode: r.statusCode }),
    },
  },
  trustProxy: true,
  bodyLimit: 2 * 1024 * 1024,
});

await app.register(cors, {
  origin: true,
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['content-type', 'accept', 'range', 'if-range'],
  exposedHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges', 'Content-Disposition'],
});

app.setErrorHandler((err: any, _req, reply) => {
  if (err instanceof ApiError) {
    return reply.code(err.status).send({ error: { status: err.status, code: err.code, message: err.message } });
  }
  const status = typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
  if (status === 500) app.log.error({ msg: err?.message }, 'unhandled error');
  return reply.code(status).send({ error: { status, code: status === 500 ? 'INTERNAL' : 'BAD_REQUEST', message: status === 500 ? 'Internal server error' : err.message } });
});

app.setNotFoundHandler((_req, reply) =>
  reply.code(404).send({ error: { status: 404, code: 'ROUTE_NOT_FOUND', message: 'Route not found' } }));

await registerRoutes(app);

if (!getToken()) app.log.warn('USER_TOKEN is not set; upstream calls will fail with SERVER_MISCONFIGURED');

openAccounts();

const shutdown = async () => {
  await app.close();
  closeAccounts();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: config.port, host: config.host });
