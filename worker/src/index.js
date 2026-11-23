const MESSAGES_PATH = "/api/messages";
const PHOTOS_PATH = "/api/photos";
const PHOTO_CONFIRM_PATH = "/api/photos/confirm";
const PHOTO_FILE_PREFIX = "/api/photos/file/";
const PLACES_PATH = "/api/places";
const SESSION_PATH = "/api/session";
const LOGIN_PATH = "/api/login";
const ACCESS_CERTS_TTL_MS = 60 * 60 * 1000;

const MAX_AUTHOR_LENGTH = 50;
const MAX_CONTENT_LENGTH = 500;
const MAX_MOOD_LENGTH = 32;
const MAX_TITLE_LENGTH = 30;
const MAX_BODY_LENGTH = 4096;
const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
const MAX_PLACE_LENGTH = 50;
const MAX_PHOTO_NAME_LENGTH = 120;

const PHOTO_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif"
};

// Places that already have a page or photos in the static site (assets/<folder>/).
// Photos uploaded with one of these addresses skip the "pick a spot on the map" step.
const STATIC_PLACE_ALIASES = [
  ["上海", "shanghai"],
  ["香港", "hongkong", "hong kong"],
  ["深圳", "shenzhen"],
  ["苏州", "suzhou"]
];

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
    "Access-Control-Allow-Credentials": "true",
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

/* ---------- Cloudflare Access ---------- */

// Cloudflare Access sits in front of this Worker and only lets the allowed emails through.
// The Worker still verifies the signed token Access adds to every request, so a misconfigured
// Access application (or a request that reaches the Worker another way) fails closed.

let accessCerts = { teamDomain: "", keys: [], fetchedAt: 0 };

function listSetting(value) {
  return String(value || "")
    .split(",")
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
}

function teamDomainOf(env) {
  return String(env.ACCESS_TEAM_DOMAIN || "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function base64UrlToBytes(value) {
  let base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
}

function decodeJwtPart(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
}

async function getAccessKeys(teamDomain, forceRefresh = false) {
  const fresh = accessCerts.teamDomain === teamDomain && Date.now() - accessCerts.fetchedAt < ACCESS_CERTS_TTL_MS;
  if (fresh && !forceRefresh) return accessCerts.keys;

  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Access certs request failed: ${response.status}`);
  const { keys } = await response.json();
  accessCerts = { teamDomain, keys: Array.isArray(keys) ? keys : [], fetchedAt: Date.now() };
  return accessCerts.keys;
}

async function verifyAccess(request, env) {
  if (env.ACCESS_DISABLED === "true") return { email: "local-dev" };

  const teamDomain = teamDomainOf(env);
  const audiences = listSetting(env.ACCESS_AUD);
  const allowedEmails = listSetting(env.ALLOWED_EMAILS);
  if (!teamDomain || !audiences.length || !allowedEmails.length) {
    console.error("Access is not configured: set ACCESS_TEAM_DOMAIN, ACCESS_AUD and ALLOWED_EMAILS");
    return null;
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  const parts = token ? token.split(".") : [];
  if (parts.length !== 3) return null;

  let header;
  let payload;
  try {
    header = decodeJwtPart(parts[0]);
    payload = decodeJwtPart(parts[1]);
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || !header.kid) return null;

  let jwk = (await getAccessKeys(teamDomain)).find(key => key.kid === header.kid);
  if (!jwk) jwk = (await getAccessKeys(teamDomain, true)).find(key => key.kid === header.kid);
  if (!jwk) return null;

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const signatureValid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  if (!signatureValid) return null;

  const now = Math.floor(Date.now() / 1000);
  const tokenAudiences = (Array.isArray(payload.aud) ? payload.aud : [payload.aud]).map(item => String(item).toLowerCase());
  const email = String(payload.email || "").toLowerCase();
  if (payload.iss !== `https://${teamDomain}`) return null;
  if (!tokenAudiences.some(item => audiences.includes(item))) return null;
  if (typeof payload.exp !== "number" || payload.exp < now) return null;
  if (typeof payload.nbf === "number" && payload.nbf > now + 60) return null;
  if (!allowedEmails.includes(email)) return null;

  return { email };
}

function loginRedirect(env, url) {
  const allowedOrigins = getAllowedOrigins(env);
  const fallback = `${allowedOrigins[0] || "https://luludeng.space"}/`;
  let target;
  try {
    target = new URL(url.searchParams.get("return") || fallback);
  } catch {
    target = new URL(fallback);
  }
  if (!allowedOrigins.includes(target.origin)) target = new URL(fallback);
  return new Response(null, { status: 302, headers: { Location: target.href, "Cache-Control": "no-store" } });
}

function normalizePlace(value) {
  return String(value || "").toLowerCase().replace(/[\s\-_.,，。/\\]+/g, "");
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

function jsonBodyError(request, env, error) {
  if (error.message === "BODY_TOO_LARGE") {
    return json(request, env, { error: "请求内容过大" }, 413);
  }
  return json(request, env, { error: "请求必须是有效的 JSON" }, 400);
}

/* ---------- messages ---------- */

async function listMessages(request, env) {
  const result = await env.DB.prepare(`
    SELECT id, author, content, created_at, mood, title
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
    return jsonBodyError(request, env, error);
  }

  const author = cleanString(body.author);
  const content = cleanString(body.content);
  const mood = body.mood == null ? null : cleanString(body.mood);
  const title = body.title == null ? "" : cleanString(body.title);

  if (title.length > MAX_TITLE_LENGTH) {
    return json(request, env, { error: `主题最多 ${MAX_TITLE_LENGTH} 个字符` }, 400);
  }
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
    mood: mood || null,
    title: title || null
  };

  await env.DB.prepare(`
    INSERT INTO messages (id, author, content, created_at, mood, title, visible)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)
  `).bind(
    message.id,
    message.author,
    message.content,
    message.created_at,
    message.mood,
    message.title
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

/* ---------- photos ---------- */

function photoFileUrl(url, objectKey) {
  return `${url.origin}${PHOTO_FILE_PREFIX}${objectKey.split("/").map(encodeURIComponent).join("/")}`;
}

function publicPhoto(url, row) {
  return {
    id: row.id,
    src: photoFileUrl(url, row.object_key),
    name: row.name,
    place: row.place,
    created_at: row.created_at
  };
}

async function isKnownPlace(env, place) {
  const wanted = normalizePlace(place);
  if (STATIC_PLACE_ALIASES.some(group => group.some(item => normalizePlace(item) === wanted))) {
    return true;
  }
  const { results } = await env.DB.prepare("SELECT name FROM places").all();
  return (results || []).some(row => normalizePlace(row.name) === wanted);
}

async function listPhotos(request, env, url) {
  const [photos, hidden] = await Promise.all([
    env.DB.prepare(`
      SELECT id, object_key, name, place, created_at
      FROM photos
      WHERE status = 'visible'
      ORDER BY created_at ASC, id ASC
    `).all(),
    env.DB.prepare("SELECT src FROM hidden_static_photos").all()
  ]);

  return json(request, env, {
    photos: (photos.results || []).map(row => publicPhoto(url, row)),
    hidden: (hidden.results || []).map(row => row.src)
  });
}

async function uploadPhoto(request, env, url) {
  const place = cleanString(url.searchParams.get("address"));
  const filename = cleanString(url.searchParams.get("filename"));
  const extension = filename.includes(".") ? filename.split(".").pop().toLowerCase() : "";
  const contentType = PHOTO_TYPES[extension];
  const size = Number(request.headers.get("Content-Length") || 0);

  if (!place || place.length > MAX_PLACE_LENGTH) {
    return json(request, env, { error: `地址长度必须为 1-${MAX_PLACE_LENGTH} 个字符` }, 400);
  }
  if (!contentType) {
    return json(request, env, { error: "暂不支持这种格式，请选择 JPG、PNG、WEBP、GIF 或 AVIF。" }, 415);
  }
  if (!size || !request.body) {
    return json(request, env, { error: "没有收到照片内容" }, 411);
  }
  if (size > MAX_PHOTO_BYTES) {
    return json(request, env, { error: "照片不能超过 25MB。" }, 413);
  }

  const id = crypto.randomUUID();
  const objectKey = `photos/${id}.${extension === "jpeg" ? "jpg" : extension}`;
  const name = (filename.replace(/\.[^.]+$/, "") || "photo").slice(0, MAX_PHOTO_NAME_LENGTH);
  const known = await isKnownPlace(env, place);
  const createdAt = new Date().toISOString();

  await env.PHOTOS.put(objectKey, request.body, {
    httpMetadata: { contentType, cacheControl: "private, max-age=31536000, immutable" },
    customMetadata: { name, place }
  });

  await env.DB.prepare(`
    INSERT INTO photos (id, object_key, name, place, content_type, size, status, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
  `).bind(id, objectKey, name, place, contentType, size, known ? "visible" : "pending", createdAt).run();

  const photo = publicPhoto(url, { id, object_key: objectKey, name, place, created_at: createdAt });
  return json(request, env, {
    ok: true,
    photo,
    needsLocation: !known,
    pendingId: known ? null : id,
    address: place
  }, 201);
}

async function confirmPhoto(request, env) {
  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    return jsonBodyError(request, env, error);
  }

  const pendingId = cleanString(body.pendingId);
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!pendingId || pendingId.length > 128) {
    return json(request, env, { error: "缺少待确认的照片" }, 400);
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90) {
    return json(request, env, { error: "地图位置无效" }, 400);
  }
  // Leaflet keeps going past ±180 when the world wraps; bring it back into range.
  const wrappedLng = ((((lng + 180) % 360) + 360) % 360) - 180;

  const photo = await env.DB.prepare(
    "SELECT id, place FROM photos WHERE id = ?1 AND status = 'pending'"
  ).bind(pendingId).first();
  if (!photo) {
    return json(request, env, { error: "没有找到这张待确认的照片，可能已经确认过了" }, 404);
  }

  const createdAt = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO places (name, lat, lng, created_at) VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT(name) DO NOTHING
    `).bind(photo.place, lat, wrappedLng, createdAt),
    env.DB.prepare("UPDATE photos SET status = 'visible' WHERE id = ?1").bind(photo.id)
  ]);

  return json(request, env, { ok: true, place: { name: photo.place, lat, lng: wrappedLng } });
}

async function deletePhoto(request, env, url) {
  const id = cleanString(url.searchParams.get("id"));
  const path = cleanString(url.searchParams.get("path"));

  if (id) {
    if (id.length > 128) return json(request, env, { error: "照片 id 无效" }, 400);
    const result = await env.DB.prepare(
      "UPDATE photos SET status = 'deleted' WHERE id = ?1 AND status != 'deleted'"
    ).bind(id).run();
    if (!result.meta?.changes) return json(request, env, { error: "没有找到这张照片" }, 404);
    return json(request, env, { ok: true });
  }

  // Photos committed to the repository can't be removed from GitHub Pages by the Worker,
  // so they are hidden from the wall instead.
  if (path && path.length <= 512 && path.startsWith("assets/") && !path.includes("..")) {
    await env.DB.prepare(`
      INSERT INTO hidden_static_photos (src, created_at) VALUES (?1, ?2)
      ON CONFLICT(src) DO NOTHING
    `).bind(path, new Date().toISOString()).run();
    return json(request, env, { ok: true });
  }

  return json(request, env, { error: "缺少有效的照片 id 或路径" }, 400);
}

async function servePhotoFile(request, env, url) {
  let objectKey;
  try {
    objectKey = decodeURIComponent(url.pathname.slice(PHOTO_FILE_PREFIX.length));
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!objectKey.startsWith("photos/") || objectKey.includes("..")) {
    return new Response("Not found", { status: 404 });
  }

  const row = await env.DB.prepare(
    "SELECT status FROM photos WHERE object_key = ?1"
  ).bind(objectKey).first();
  if (!row || row.status === "deleted") {
    return new Response("Not found", { status: 404 });
  }

  const object = await env.PHOTOS.get(objectKey, {
    onlyIf: request.headers,
    range: request.headers
  });
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "private, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");

  if (!("body" in object) || !object.body) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(object.body, { headers });
}

/* ---------- places ---------- */

async function listPlaces(request, env) {
  const { results } = await env.DB.prepare(
    "SELECT name, lat, lng, created_at FROM places ORDER BY created_at ASC"
  ).all();
  return json(request, env, { places: results || [] });
}

/* ---------- router ---------- */

async function route(request, env, url, user) {
  const { pathname } = url;
  const method = request.method;

  if (pathname === SESSION_PATH) {
    if (method === "GET") return json(request, env, { ok: true, email: user.email });
    return json(request, env, { error: "Method not allowed" }, 405);
  }

  // Opened as a page (not fetched): Access shows its login screen first, then we send the visitor back.
  if (pathname === LOGIN_PATH) {
    if (method === "GET") return loginRedirect(env, url);
    return json(request, env, { error: "Method not allowed" }, 405);
  }

  if (pathname === MESSAGES_PATH) {
    if (method === "GET") return listMessages(request, env);
    if (method === "POST") return createMessage(request, env);
    if (method === "DELETE") return deleteMessage(request, env, url);
    return json(request, env, { error: "Method not allowed" }, 405);
  }

  if (pathname === PHOTOS_PATH) {
    if (method === "GET") return listPhotos(request, env, url);
    if (method === "POST") return uploadPhoto(request, env, url);
    if (method === "DELETE") return deletePhoto(request, env, url);
    return json(request, env, { error: "Method not allowed" }, 405);
  }

  if (pathname === PHOTO_CONFIRM_PATH) {
    if (method === "POST") return confirmPhoto(request, env);
    return json(request, env, { error: "Method not allowed" }, 405);
  }

  if (pathname.startsWith(PHOTO_FILE_PREFIX)) {
    if (method === "GET" || method === "HEAD") return servePhotoFile(request, env, url);
    return json(request, env, { error: "Method not allowed" }, 405);
  }

  if (pathname === PLACES_PATH) {
    if (method === "GET") return listPlaces(request, env);
    return json(request, env, { error: "Method not allowed" }, 405);
  }

  return json(request, env, { error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!isOriginAllowed(request, env)) {
      return json(request, env, { error: "Origin not allowed" }, 403);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    try {
      const user = await verifyAccess(request, env);
      if (!user) {
        return json(request, env, { error: "需要先登录", login: `${url.origin}${LOGIN_PATH}` }, 401);
      }
      return await route(request, env, url, user);
    } catch (error) {
      console.error("API error", error);
      return json(request, env, { error: "服务器暂时无法处理请求" }, 500);
    }
  }
};
