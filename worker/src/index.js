const MESSAGES_PATH = "/api/messages";
const PHOTOS_PATH = "/api/photos";
const PHOTO_CONFIRM_PATH = "/api/photos/confirm";
const PHOTO_FILE_PREFIX = "/api/photos/file/";
const PLACES_PATH = "/api/places";
const WISHES_PATH = "/api/wishes";
const WISH_CHECK_PATH = "/api/wishes/check";
const WISH_ALLOWANCE_PATH = "/api/wishes/allowance";
const PINS_PATH = "/api/pins";
const PIN_RESTORE_PATH = "/api/pins/restore";
const PIN_HIDDEN_PATH = "/api/pins/hidden";
const FOOD_PATH = "/api/food";
const FOOD_UPDATE_PATH = "/api/food/update";
const FOOD_PHOTOS_PATH = "/api/food/photos";
const FOOD_FILE_PREFIX = "/api/food/file/";
const SESSION_PATH = "/api/session";
const LOGIN_PATH = "/api/login";
const ACCESS_CERTS_TTL_MS = 60 * 60 * 1000;

const MAX_AUTHOR_LENGTH = 50;
const MAX_CONTENT_LENGTH = 5000;
const MAX_MOOD_LENGTH = 32;
const MAX_TITLE_LENGTH = 30;
const MAX_BODY_LENGTH = 65536; // 5000 Chinese characters are ~15 KB as UTF-8 JSON
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

async function createMessage(request, env, user, ctx) {
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

  // Tell the other person by email. Runs after the response so a mail problem never blocks the message.
  const notice = notifyNewMessage(env, user, message).catch(error => console.error("notify email failed", error));
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(notice);

  return json(request, env, { ok: true, message }, 201);
}

/* ---------- new message email ---------- */

// NOTIFY_EMAIL is a send_email binding (Cloudflare Email Routing); both addresses must be verified
// destinations there. The email only says a new message arrived — the content stays on the site.
const NOTIFY_FROM = "notify@luludeng.space";
const SITE_URL = "https://luludeng.space/";

function emailOf(env, person) {
  for (const pair of String(env.WISH_OWNERS || "").split(",")) {
    const [key, address] = pair.split("=").map(part => part.trim());
    if (key && key.toLowerCase() === person && address) return address;
  }
  return null;
}

function base64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function shanghaiTime(iso) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(iso)).map(part => [part.type, part.value]));
  return `${parts.year}.${parts.month}.${parts.day} ${parts.hour}:${parts.minute}`;
}

function buildNoticeEmail(fromName, to, toName, message) {
  const subject = `${fromName}给你写了一封新留言`;
  const text = [
    `${toName}：`,
    "",
    `${fromName}在留言板给你写了一封新留言（${shanghaiTime(message.created_at)}）。`,
    "",
    `登录网站去看看吧：${SITE_URL}`,
    "",
    "—— 噜噜 & 噔噔的小站"
  ].join("\r\n");
  const body = base64Utf8(text).replace(/.{1,76}/g, "$&\r\n");
  return [
    `From: =?UTF-8?B?${base64Utf8("噜噜 & 噔噔的小站")}?= <${NOTIFY_FROM}>`,
    `To: <${to}>`,
    `Subject: =?UTF-8?B?${base64Utf8(subject)}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@luludeng.space>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    body
  ].join("\r\n");
}

async function notifyNewMessage(env, user, message) {
  if (!env.NOTIFY_EMAIL) return;
  const writer = personOf(env, user);
  if (!writer) return;
  const reader = Object.keys(PEOPLE).find(key => key !== writer);
  const to = reader && emailOf(env, reader);
  if (!to) return;
  const raw = buildNoticeEmail(PEOPLE[writer], to, PEOPLE[reader], message);
  const { EmailMessage } = await import("cloudflare:email");
  await env.NOTIFY_EMAIL.send(new EmailMessage(NOTIFY_FROM, to, raw));
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

/* ---------- wishes ---------- */

// Each person has their own wish list. Making a wish uses one slot of their allowance; the allowance is
// a ledger (wish_allowance) that the owner can raise (with a reason) or lower. Remaining =
// sum(allowance deltas) - wishes made (deleted pending wishes give their slot back).
const PEOPLE = { lulu: "噜噜", dengdeng: "噔噔" };
const MAX_WISH_LENGTH = 200;
const MAX_REASON_LENGTH = 100;
const MAX_ALLOWANCE_STEP = 20;

// WISH_OWNERS secret: "lulu=email1,dengdeng=email2". Unknown emails can read but not change anything.
function personOf(env, user) {
  if (env.ACCESS_DISABLED === "true" && env.DEV_PERSON) return env.DEV_PERSON;
  const email = String(user.email || "").toLowerCase();
  for (const pair of String(env.WISH_OWNERS || "").split(",")) {
    const [person, address] = pair.split("=").map(part => part.trim().toLowerCase());
    if (PEOPLE[person] && address && address === email) return person;
  }
  return null;
}

async function wishSummary(env, owner) {
  const [wishes, allowance] = await Promise.all([
    env.DB.prepare(`
      SELECT id, text, created_at, done, done_at, done_by
      FROM wishes WHERE owner = ?1 AND visible = 1
      ORDER BY created_at ASC, id ASC
    `).bind(owner).all(),
    env.DB.prepare(`
      SELECT delta, reason, created_by, created_at
      FROM wish_allowance WHERE owner = ?1
      ORDER BY created_at DESC, id DESC
    `).bind(owner).all()
  ]);
  const list = (wishes.results || []).map(row => ({ ...row, done: row.done === 1 }));
  const changes = allowance.results || [];
  const granted = changes.reduce((sum, row) => sum + Number(row.delta || 0), 0);
  const done = list.filter(wish => wish.done).length;
  return {
    key: owner,
    name: PEOPLE[owner],
    done,
    pending: list.length - done,
    granted,
    remaining: Math.max(0, granted - list.length),
    wishes: list,
    allowance: changes.slice(0, 50)
  };
}

async function listWishes(request, env, user) {
  const me = personOf(env, user);
  const people = await Promise.all(Object.keys(PEOPLE).map(owner => wishSummary(env, owner)));
  return json(request, env, { me, people });
}

async function requirePerson(request, env, user) {
  const me = personOf(env, user);
  if (!me) return { error: json(request, env, { error: "没有认出你是噜噜还是噔噔，请检查 WISH_OWNERS 设置" }, 403) };
  return { me };
}

async function createWish(request, env, user) {
  const { me, error } = await requirePerson(request, env, user);
  if (error) return error;
  let body;
  try {
    body = await readJsonBody(request);
  } catch (bodyError) {
    return jsonBodyError(request, env, bodyError);
  }
  const text = cleanString(body.text);
  if (!text || text.length > MAX_WISH_LENGTH) {
    return json(request, env, { error: `愿望需要 1-${MAX_WISH_LENGTH} 个字` }, 400);
  }
  const summary = await wishSummary(env, me);
  if (summary.remaining < 1) {
    return json(request, env, { error: "许愿名额用完了，先增加名额吧" }, 409);
  }
  const wish = { id: crypto.randomUUID(), text, created_at: new Date().toISOString() };
  await env.DB.prepare(`
    INSERT INTO wishes (id, owner, text, created_at, done, visible) VALUES (?1, ?2, ?3, ?4, 0, 1)
  `).bind(wish.id, me, wish.text, wish.created_at).run();
  return json(request, env, { ok: true, wish }, 201);
}

async function checkWish(request, env, user) {
  const { me, error } = await requirePerson(request, env, user);
  if (error) return error;
  let body;
  try {
    body = await readJsonBody(request);
  } catch (bodyError) {
    return jsonBodyError(request, env, bodyError);
  }
  const id = cleanString(body.id);
  if (!id || id.length > 128) return json(request, env, { error: "缺少有效的愿望 id" }, 400);
  const done = body.done === true;
  const result = await env.DB.prepare(`
    UPDATE wishes
    SET done = ?2, done_at = ?3, done_by = ?4
    WHERE id = ?1 AND visible = 1
  `).bind(id, done ? 1 : 0, done ? new Date().toISOString() : null, done ? me : null).run();
  if (!result.meta?.changes) return json(request, env, { error: "没有找到这个愿望" }, 404);
  return json(request, env, { ok: true });
}

async function deleteWish(request, env, user, url) {
  const { me, error } = await requirePerson(request, env, user);
  if (error) return error;
  const id = cleanString(url.searchParams.get("id"));
  if (!id || id.length > 128) return json(request, env, { error: "缺少有效的愿望 id" }, 400);
  const result = await env.DB.prepare(`
    UPDATE wishes SET visible = 0
    WHERE id = ?1 AND owner = ?2 AND done = 0 AND visible = 1
  `).bind(id, me).run();
  if (!result.meta?.changes) {
    return json(request, env, { error: "只能删除自己还没实现的愿望" }, 404);
  }
  return json(request, env, { ok: true });
}

async function changeAllowance(request, env, user) {
  const { me, error } = await requirePerson(request, env, user);
  if (error) return error;
  let body;
  try {
    body = await readJsonBody(request);
  } catch (bodyError) {
    return jsonBodyError(request, env, bodyError);
  }
  const delta = Number(body.delta);
  const reason = cleanString(body.reason);
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX_ALLOWANCE_STEP) {
    return json(request, env, { error: `每次可以增减 1-${MAX_ALLOWANCE_STEP} 个名额` }, 400);
  }
  if (delta > 0 && !reason) {
    return json(request, env, { error: "增加名额需要写一个理由" }, 400);
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return json(request, env, { error: `理由最多 ${MAX_REASON_LENGTH} 个字` }, 400);
  }
  if (delta < 0) {
    const summary = await wishSummary(env, me);
    if (summary.remaining + delta < 0) {
      return json(request, env, { error: `最多只能减少 ${summary.remaining} 个` }, 409);
    }
  }
  await env.DB.prepare(`
    INSERT INTO wish_allowance (id, owner, delta, reason, created_by, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
  `).bind(crypto.randomUUID(), me, delta, reason || null, me, new Date().toISOString()).run();
  return json(request, env, { ok: true });
}

/* ---------- map pins ---------- */

// Footprints and wishes added on the map, plus places hidden from it (right-click delete),
// shared by every device. Deletes are soft so 撤销 can bring them back.
const MAX_PIN_NAME_LENGTH = 50;
const MAX_HIDDEN_KEY_LENGTH = 200;

function wrapLongitude(lng) {
  const wrapped = lng >= -180 && lng <= 180 ? lng : ((((lng + 180) % 360) + 360) % 360) - 180;
  return Math.round(wrapped * 1e6) / 1e6;
}

async function listPins(request, env) {
  const [pins, hidden] = await Promise.all([
    env.DB.prepare(`
      SELECT id, name, type, lat, lng, created_by, created_at
      FROM map_pins WHERE visible = 1
      ORDER BY created_at ASC, id ASC
    `).all(),
    env.DB.prepare("SELECT key FROM map_hidden").all()
  ]);
  return json(request, env, {
    pins: pins.results || [],
    hidden: (hidden.results || []).map(row => row.key)
  });
}

async function createPin(request, env, user) {
  let body;
  try {
    body = await readJsonBody(request);
  } catch (bodyError) {
    return jsonBodyError(request, env, bodyError);
  }
  const name = cleanString(body.name);
  const type = body.type === "wish" ? "wish" : body.type === "footprint" ? "footprint" : "";
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!name || name.length > MAX_PIN_NAME_LENGTH) {
    return json(request, env, { error: `地点名称需要 1-${MAX_PIN_NAME_LENGTH} 个字` }, 400);
  }
  if (!type) return json(request, env, { error: "图钉类型无效" }, 400);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90) {
    return json(request, env, { error: "地图位置无效" }, 400);
  }
  const pin = {
    id: crypto.randomUUID(),
    name,
    type,
    lat: Math.round(lat * 1e6) / 1e6,
    lng: wrapLongitude(lng),
    created_by: personOf(env, user) || null,
    created_at: new Date().toISOString()
  };
  await env.DB.prepare(`
    INSERT INTO map_pins (id, name, type, lat, lng, created_by, created_at, visible)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1)
  `).bind(pin.id, pin.name, pin.type, pin.lat, pin.lng, pin.created_by, pin.created_at).run();
  return json(request, env, { ok: true, pin }, 201);
}

async function deletePins(request, env, url) {
  if (url.searchParams.get("all") === "1") {
    await env.DB.prepare("UPDATE map_pins SET visible = 0 WHERE visible = 1").run();
    return json(request, env, { ok: true });
  }
  const id = cleanString(url.searchParams.get("id"));
  if (!id || id.length > 128) return json(request, env, { error: "缺少有效的图钉 id" }, 400);
  const result = await env.DB.prepare("UPDATE map_pins SET visible = 0 WHERE id = ?1 AND visible = 1").bind(id).run();
  if (!result.meta?.changes) return json(request, env, { error: "没有找到这个图钉" }, 404);
  return json(request, env, { ok: true });
}

async function restorePin(request, env) {
  let body;
  try {
    body = await readJsonBody(request);
  } catch (bodyError) {
    return jsonBodyError(request, env, bodyError);
  }
  const id = cleanString(body.id);
  if (!id || id.length > 128) return json(request, env, { error: "缺少有效的图钉 id" }, 400);
  const result = await env.DB.prepare("UPDATE map_pins SET visible = 1 WHERE id = ?1 AND visible = 0").bind(id).run();
  if (!result.meta?.changes) return json(request, env, { error: "没有找到可以恢复的图钉" }, 404);
  return json(request, env, { ok: true });
}

async function hidePlace(request, env) {
  let body;
  try {
    body = await readJsonBody(request);
  } catch (bodyError) {
    return jsonBodyError(request, env, bodyError);
  }
  const key = cleanString(body.key);
  if (!key || key.length > MAX_HIDDEN_KEY_LENGTH) return json(request, env, { error: "地点标识无效" }, 400);
  await env.DB.prepare(`
    INSERT INTO map_hidden (key, created_at) VALUES (?1, ?2) ON CONFLICT(key) DO NOTHING
  `).bind(key, new Date().toISOString()).run();
  return json(request, env, { ok: true });
}

async function unhidePlace(request, env, url) {
  const key = cleanString(url.searchParams.get("key"));
  if (!key || key.length > MAX_HIDDEN_KEY_LENGTH) return json(request, env, { error: "地点标识无效" }, 400);
  await env.DB.prepare("DELETE FROM map_hidden WHERE key = ?1").bind(key).run();
  return json(request, env, { ok: true });
}

/* ---------- food map ---------- */

// A food spot is a place we ate (name, city + optional street address, note, rating, date) with up
// to MAX_FOOD_PHOTOS photos. Ratings go from 0.5 to 5 in half stars and are stored in `stars`; the
// older whole-star `rating` column is only read as a fallback (migration 0007).
// Photos are stored in R2 under food/. The map pins spots at their city's position.
const MAX_FOOD_NAME_LENGTH = 40;
const MAX_FOOD_CITY_LENGTH = 50;
const MAX_FOOD_ADDRESS_LENGTH = 100;
const MAX_FOOD_NOTE_LENGTH = 500;
const MAX_FOOD_PHOTOS = 9;
const MAX_FOOD_PHOTO_BYTES = 15 * 1024 * 1024;

function foodFileUrl(url, objectKey) {
  return `${url.origin}${FOOD_FILE_PREFIX}${objectKey.split("/").map(encodeURIComponent).join("/")}`;
}

// Validates the editable fields of a spot. Returns { spot } or { error }.
function readFoodFields(body) {
  const name = cleanString(body.name);
  const city = cleanString(body.city);
  const address = cleanString(body.address);
  const note = cleanString(body.note);
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const rating = body.rating == null || body.rating === "" ? null : Number(body.rating);
  const visitedOn = cleanString(body.visited_on);
  if (!name || name.length > MAX_FOOD_NAME_LENGTH) return { error: `店名需要 1-${MAX_FOOD_NAME_LENGTH} 个字` };
  if (!city || city.length > MAX_FOOD_CITY_LENGTH) return { error: "请选择城市" };
  if (address.length > MAX_FOOD_ADDRESS_LENGTH) return { error: `详细地址最多 ${MAX_FOOD_ADDRESS_LENGTH} 个字` };
  if (note.length > MAX_FOOD_NOTE_LENGTH) return { error: `评价最多 ${MAX_FOOD_NOTE_LENGTH} 个字` };
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90) return { error: "地图位置无效" };
  if (rating !== null && !(Number.isInteger(rating * 2) && rating >= 0.5 && rating <= 5)) return { error: "评分需要 0.5-5 颗星（可以打半颗）" };
  if (visitedOn && !/^\d{4}-\d{2}-\d{2}$/.test(visitedOn)) return { error: "日期格式无效" };
  return {
    spot: {
      name, city, address, note, rating,
      lat: Math.round(lat * 1e6) / 1e6,
      lng: wrapLongitude(lng),
      visited_on: visitedOn || null
    }
  };
}

async function listFood(request, env, url) {
  const [spots, photos] = await Promise.all([
    env.DB.prepare(`
      SELECT id, name, city, address, lat, lng, note, COALESCE(stars, rating) AS rating, visited_on, created_by, created_at
      FROM food_spots WHERE visible = 1
      ORDER BY COALESCE(visited_on, substr(created_at, 1, 10)) DESC, created_at DESC
    `).all(),
    env.DB.prepare(`
      SELECT p.id, p.spot_id, p.object_key FROM food_photos p
      JOIN food_spots s ON s.id = p.spot_id AND s.visible = 1
      WHERE p.visible = 1 ORDER BY p.created_at ASC, p.id ASC
    `).all()
  ]);
  const bySpot = new Map();
  for (const photo of photos.results || []) {
    if (!bySpot.has(photo.spot_id)) bySpot.set(photo.spot_id, []);
    bySpot.get(photo.spot_id).push({ id: photo.id, src: foodFileUrl(url, photo.object_key) });
  }
  return json(request, env, {
    spots: (spots.results || []).map(spot => ({ ...spot, photos: bySpot.get(spot.id) || [] }))
  });
}

async function createFood(request, env, user) {
  let body;
  try {
    body = await readJsonBody(request);
  } catch (bodyError) {
    return jsonBodyError(request, env, bodyError);
  }
  const { spot, error } = readFoodFields(body);
  if (error) return json(request, env, { error }, 400);
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const createdBy = personOf(env, user) || null;
  await env.DB.prepare(`
    INSERT INTO food_spots (id, name, city, address, lat, lng, note, stars, visited_on, created_by, created_at, visible)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1)
  `).bind(id, spot.name, spot.city, spot.address, spot.lat, spot.lng, spot.note, spot.rating, spot.visited_on, createdBy, createdAt).run();
  return json(request, env, { ok: true, spot: { id, ...spot, created_by: createdBy, created_at: createdAt, photos: [] } }, 201);
}

async function updateFood(request, env) {
  let body;
  try {
    body = await readJsonBody(request);
  } catch (bodyError) {
    return jsonBodyError(request, env, bodyError);
  }
  const id = cleanString(body.id);
  if (!id || id.length > 128) return json(request, env, { error: "缺少有效的美食 id" }, 400);
  const { spot, error } = readFoodFields(body);
  if (error) return json(request, env, { error }, 400);
  const result = await env.DB.prepare(`
    UPDATE food_spots SET name = ?2, city = ?3, address = ?4, lat = ?5, lng = ?6, note = ?7, stars = ?8, rating = NULL, visited_on = ?9
    WHERE id = ?1 AND visible = 1
  `).bind(id, spot.name, spot.city, spot.address, spot.lat, spot.lng, spot.note, spot.rating, spot.visited_on).run();
  if (!result.meta?.changes) return json(request, env, { error: "没有找到这家店" }, 404);
  return json(request, env, { ok: true });
}

async function deleteFood(request, env, url) {
  const id = cleanString(url.searchParams.get("id"));
  if (!id || id.length > 128) return json(request, env, { error: "缺少有效的美食 id" }, 400);
  const result = await env.DB.prepare("UPDATE food_spots SET visible = 0 WHERE id = ?1 AND visible = 1").bind(id).run();
  if (!result.meta?.changes) return json(request, env, { error: "没有找到这家店" }, 404);
  return json(request, env, { ok: true });
}

async function uploadFoodPhoto(request, env, url) {
  const spotId = cleanString(url.searchParams.get("spot"));
  const filename = cleanString(url.searchParams.get("filename"));
  const extension = filename.includes(".") ? filename.split(".").pop().toLowerCase() : "";
  const contentType = PHOTO_TYPES[extension];
  const size = Number(request.headers.get("Content-Length") || 0);
  if (!spotId || spotId.length > 128) return json(request, env, { error: "缺少有效的美食 id" }, 400);
  if (!contentType) return json(request, env, { error: "暂不支持这种格式，请选择 JPG、PNG、WEBP、GIF 或 AVIF。" }, 415);
  if (!size || !request.body) return json(request, env, { error: "没有收到照片内容" }, 411);
  if (size > MAX_FOOD_PHOTO_BYTES) return json(request, env, { error: "照片不能超过 15MB。" }, 413);

  const spot = await env.DB.prepare(`
    SELECT (SELECT COUNT(*) FROM food_photos WHERE spot_id = ?1 AND visible = 1) AS photo_count
    FROM food_spots WHERE id = ?1 AND visible = 1
  `).bind(spotId).first();
  if (!spot) return json(request, env, { error: "没有找到这家店" }, 404);
  if (spot.photo_count >= MAX_FOOD_PHOTOS) return json(request, env, { error: `每家店最多 ${MAX_FOOD_PHOTOS} 张照片` }, 409);

  const id = crypto.randomUUID();
  const objectKey = `food/${id}.${extension === "jpeg" ? "jpg" : extension}`;
  await env.PHOTOS.put(objectKey, request.body, {
    httpMetadata: { contentType, cacheControl: "private, max-age=31536000, immutable" },
    customMetadata: { spot: spotId }
  });
  await env.DB.prepare(`
    INSERT INTO food_photos (id, spot_id, object_key, content_type, size, created_at, visible)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)
  `).bind(id, spotId, objectKey, contentType, size, new Date().toISOString()).run();
  return json(request, env, { ok: true, photo: { id, src: foodFileUrl(url, objectKey) } }, 201);
}

async function deleteFoodPhoto(request, env, url) {
  const id = cleanString(url.searchParams.get("id"));
  if (!id || id.length > 128) return json(request, env, { error: "缺少有效的照片 id" }, 400);
  const result = await env.DB.prepare("UPDATE food_photos SET visible = 0 WHERE id = ?1 AND visible = 1").bind(id).run();
  if (!result.meta?.changes) return json(request, env, { error: "没有找到这张照片" }, 404);
  return json(request, env, { ok: true });
}

async function serveFoodFile(request, env, url) {
  let objectKey;
  try {
    objectKey = decodeURIComponent(url.pathname.slice(FOOD_FILE_PREFIX.length));
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!objectKey.startsWith("food/") || objectKey.includes("..")) return new Response("Not found", { status: 404 });
  const row = await env.DB.prepare("SELECT visible FROM food_photos WHERE object_key = ?1").bind(objectKey).first();
  if (!row || !row.visible) return new Response("Not found", { status: 404 });

  const object = await env.PHOTOS.get(objectKey, { onlyIf: request.headers, range: request.headers });
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "private, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  if (!("body" in object) || !object.body) return new Response(null, { status: 304, headers });
  return new Response(object.body, { headers });
}

/* ---------- router ---------- */

async function route(request, env, url, user, ctx) {
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
    if (method === "POST") return createMessage(request, env, user, ctx);
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

  if (pathname === WISHES_PATH) {
    if (method === "GET") return listWishes(request, env, user);
    if (method === "POST") return createWish(request, env, user);
    if (method === "DELETE") return deleteWish(request, env, user, url);
    return json(request, env, { error: "Method not allowed" }, 405);
  }

  if (pathname === WISH_CHECK_PATH) {
    if (method === "POST") return checkWish(request, env, user);
    return json(request, env, { error: "Method not allowed" }, 405);
  }

  if (pathname === WISH_ALLOWANCE_PATH) {
    if (method === "POST") return changeAllowance(request, env, user);
    return json(request, env, { error: "Method not allowed" }, 405);
  }

  if (pathname === PINS_PATH) {
    if (method === "GET") return listPins(request, env);
    if (method === "POST") return createPin(request, env, user);
    if (method === "DELETE") return deletePins(request, env, url);
    return json(request, env, { error: "Method not allowed" }, 405);
  }

  if (pathname === PIN_RESTORE_PATH) {
    if (method === "POST") return restorePin(request, env);
    return json(request, env, { error: "Method not allowed" }, 405);
  }

  if (pathname === PIN_HIDDEN_PATH) {
    if (method === "POST") return hidePlace(request, env);
    if (method === "DELETE") return unhidePlace(request, env, url);
    return json(request, env, { error: "Method not allowed" }, 405);
  }

  if (pathname === FOOD_PATH) {
    if (method === "GET") return listFood(request, env, url);
    if (method === "POST") return createFood(request, env, user);
    if (method === "DELETE") return deleteFood(request, env, url);
    return json(request, env, { error: "Method not allowed" }, 405);
  }

  if (pathname === FOOD_UPDATE_PATH) {
    if (method === "POST") return updateFood(request, env);
    return json(request, env, { error: "Method not allowed" }, 405);
  }

  if (pathname === FOOD_PHOTOS_PATH) {
    if (method === "POST") return uploadFoodPhoto(request, env, url);
    if (method === "DELETE") return deleteFoodPhoto(request, env, url);
    return json(request, env, { error: "Method not allowed" }, 405);
  }

  if (pathname.startsWith(FOOD_FILE_PREFIX)) {
    if (method === "GET" || method === "HEAD") return serveFoodFile(request, env, url);
    return json(request, env, { error: "Method not allowed" }, 405);
  }

  return json(request, env, { error: "Not found" }, 404);
}

export default {
  async fetch(request, env, ctx) {
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
      return await route(request, env, url, user, ctx);
    } catch (error) {
      console.error("API error", error);
      return json(request, env, { error: "服务器暂时无法处理请求" }, 500);
    }
  }
};
