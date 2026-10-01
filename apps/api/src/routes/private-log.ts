// The private log gateway is authenticated twice: Nginx Basic Auth, then a server-only token.
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { config, credential } from "@aihot/backend/config";
import { feedbackScreenshot, listFeedback, updateFeedback } from "@aihot/backend/admin/feedback";
import { Conflict } from "@aihot/backend/admin/sources";
import { sendProblem } from "../http/respond.ts";

export function registerPrivateLog(app: FastifyInstance) {
  app.register(async (privateApp) => {
    privateApp.addHook("onRequest", async (req, reply) => {
      reply.header("Cache-Control", "private, no-store").header("X-Robots-Tag", "noindex, nofollow").header("X-Content-Type-Options", "nosniff");
      const expected = credential("auth", "PRIVATE_LOG_API_TOKEN") ?? "";
      const supplied = String(req.headers["x-filmtech-log-token"] ?? "");
      const expectedBytes = Buffer.from(expected), suppliedBytes = Buffer.from(supplied);
      if (expected.length < 32 || suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes) || req.headers["x-filmtech-log-user"] !== "admin") {
        return sendProblem(req, reply, { status: 403, code: "forbidden", detail: "private log authentication required" });
      }
      if (req.method === "PATCH" && (req.headers.origin !== new URL(config.siteUrl).origin || (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin"))) {
        return sendProblem(req, reply, { status: 403, code: "forbidden", detail: "same-origin request required" });
      }
    });

    privateApp.get("/feedback", async (req, reply) => {
      const query = req.query as { status?: string; q?: string; page?: string };
      const page = Number(query.page ?? 1);
      if (!Number.isSafeInteger(page) || page < 1 || page > 100_000 || (query.status && query.status !== "new") || (query.q?.length ?? 0) > 200) {
        return sendProblem(req, reply, { status: 400, code: "invalid_request", detail: "invalid feedback filters" });
      }
      const data = await listFeedback({ status: query.status || undefined, q: query.q, page });
      return {
        page, counts: data.counts, hasMore: data.rows.length === 50,
        rows: data.rows.map(({ id, content, email, page_url, screenshot, status, note, created_at, updated_at }) => ({ id, content, email, page_url, screenshot, status, note, created_at, updated_at })),
      };
    });

    privateApp.patch("/feedback/:id/viewed", { bodyLimit: 512 }, async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      const body = req.body as { version?: unknown } | null;
      if (!Number.isSafeInteger(id) || id < 1 || !body || typeof body.version !== "string" || body.version.length > 60 || Object.keys(body).some((key) => key !== "version")) {
        return sendProblem(req, reply, { status: 400, code: "invalid_request", detail: "feedback version required" });
      }
      try {
        const result = await updateFeedback(id, { version: body.version, status: "triaged" }, "private-log:admin", { onlyNew: true });
        if (!result) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "feedback not found" });
        return { id: result.id, status: result.status, updated_at: result.updated_at };
      } catch (error) {
        if (error instanceof Conflict) return sendProblem(req, reply, { status: 409, code: "conflict", detail: "反馈已被修改，请刷新后再操作。" });
        throw error;
      }
    });

    privateApp.get("/feedback/:id/screenshot", async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      const file = Number.isSafeInteger(id) && id > 0 ? await feedbackScreenshot(id) : null;
      const data = file ? await readFile(file).catch(() => null) : null;
      if (!data) return sendProblem(req, reply, { status: 404, code: "not_found", detail: "screenshot not available" });
      const ext = file!.split(".").pop();
      return reply.type(ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`).send(data);
    });
  }, { prefix: "/api/private-log" });
}
