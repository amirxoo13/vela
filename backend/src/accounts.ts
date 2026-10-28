import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { dispatchAccount, type AccountResult } from "../lib/accounts.mjs";

const routes: Array<[string, string]> = [
  ["POST", "/auth/signup"],
  ["POST", "/auth/login"],
  ["POST", "/auth/logout"],
  ["GET", "/auth/me"],
  ["PATCH", "/auth/me"],
  ["POST", "/auth/password"],
  ["DELETE", "/auth/me"],
  ["GET", "/me/library"],
  ["POST", "/me/library/import"],
  ["PUT", "/me/likes"],
  ["DELETE", "/me/likes/:trackId"],
  ["POST", "/me/playlists"],
  ["PATCH", "/me/playlists/:id"],
  ["DELETE", "/me/playlists/:id"],
  ["POST", "/me/history"],
  ["PUT", "/me/follows"],
  ["DELETE", "/me/follows/:artistId"],
  ["PUT", "/me/albums"],
  ["DELETE", "/me/albums/:albumId"],
  ["PATCH", "/me/settings"],
  ["GET", "/avatars/:userId"],
];

async function handle(req: FastifyRequest, reply: FastifyReply) {
  const result = (await dispatchAccount({
    method: req.method,
    path: req.url,
    headers: req.headers as Record<string, string | string[] | undefined>,
    body: req.body,
    ip: req.ip,
  })) as AccountResult | null;
  if (!result) return reply.callNotFound();
  if (result.cookies) {
    for (const cookie of result.cookies) reply.header("set-cookie", cookie);
  }
  if (result.headers) {
    for (const [key, value] of Object.entries(result.headers)) reply.header(key, value);
  }
  reply.code(result.status);
  if (result.raw) return reply.send(result.raw);
  return reply.send(result.json ?? null);
}

export function registerAccountRoutes(api: FastifyInstance) {
  for (const [method, url] of routes) {
    api.route({ method: method as "GET", url, handler: handle });
  }
}
