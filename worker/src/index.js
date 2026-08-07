const API_PATH = "/api/messages";
const MAX_AUTHOR_LENGTH = 50;
const MAX_CONTENT_LENGTH = 500;
const MAX_MOOD_LENGTH = 32;
const MAX_BODY_LENGTH = 4096;

function getAllowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "https://luludeng.space")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const headers = {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };

  if (origin && getAllowedOrigins(env).includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function json(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(request, env)
    }
  });
}

function isOriginAllowed(request, env) {
  const origin = request.headers.get("Origin");
  return !origin || getAllowedOrigins(env).includes(origin);
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function readJsonBody(request) {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > MAX_BODY_LENGTH) {
    throw new Error("BODY_TOO_LARGE");
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_LENGTH) {
    throw new Error("BODY_TOO_LARGE");
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("INVALID_JSON");
  }
}

async function listMessages(request, env) {
  const result = await env.DB.prepare(`
    SELECT id, author, content, created_at, mood
    FROM messages
    WHERE visible = 1
    ORDER BY created_at ASC, id ASC
  `).all();

  return json(request, env, { messages: result.results || [] });
}

async function createMessage(request, env) {
  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    if (error.message === "BODY_TOO_LARGE") {
      return json(request, env, { error: "请求内容过大" }, 413);
    }
    return json(request, env, { error: "请求必须是有效的 JSON" }, 400);
  }

  const author = cleanString(body.author);
  const content = cleanString(body.content);
  const mood = body.mood == null ? null : cleanString(body.mood);

  if (!author || author.length > MAX_AUTHOR_LENGTH) {
    return json(request, env, { error: `author 长度必须为 1-${MAX_AUTHOR_LENGTH} 个字符` }, 400);
  }
  if (!content || content.length > MAX_CONTENT_LENGTH) {
    return json(request, env, { error: `content 长度必须为 1-${MAX_CONTENT_LENGTH} 个字符` }, 400);
  }
  if (mood !== null && mood.length > MAX_MOOD_LENGTH) {
    return json(request, env, { error: `mood 最多 ${MAX_MOOD_LENGTH} 个字符` }, 400);
  }

  const message = {
    id: crypto.randomUUID(),
    author,
    content,
    created_at: new Date().toISOString(),
    mood: mood || null
  };

  await env.DB.prepare(`
    INSERT INTO messages (id, author, content, created_at, mood, visible)
    VALUES (?1, ?2, ?3, ?4, ?5, 1)
  `).bind(
    message.id,
    message.author,
    message.content,
    message.created_at,
    message.mood
  ).run();

  return json(request, env, { ok: true, message }, 201);
}

async function deleteMessage(request, env, url) {
  const id = cleanString(url.searchParams.get("id"));
  if (!id || id.length > 128) {
    return json(request, env, { error: "缺少有效的留言 id" }, 400);
  }

  const result = await env.DB.prepare(`
    UPDATE messages
    SET visible = 0
    WHERE id = ?1 AND visible = 1
  `).bind(id).run();

  if (!result.meta?.changes) {
    return json(request, env, { error: "没有找到这条留言" }, 404);
  }

  return json(request, env, { ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== API_PATH) {
      return json(request, env, { error: "Not found" }, 404);
    }

    if (request.method === "OPTIONS") {
      if (!isOriginAllowed(request, env)) {
        return json(request, env, { error: "Origin not allowed" }, 403);
      }
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    if (!isOriginAllowed(request, env)) {
      return json(request, env, { error: "Origin not allowed" }, 403);
    }

    try {
      if (request.method === "GET") return await listMessages(request, env);
      if (request.method === "POST") return await createMessage(request, env);
      if (request.method === "DELETE") return await deleteMessage(request, env, url);
      return json(request, env, { error: "Method not allowed" }, 405);
    } catch (error) {
      console.error("messages API error", error);
      return json(request, env, { error: "服务器暂时无法处理请求" }, 500);
    }
  }
};
