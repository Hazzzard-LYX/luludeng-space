// Shared access to the Cloudflare Worker API (worker/src/index.js), which sits behind Cloudflare Access.
// To point the pages at a local `wrangler dev`, set window.LULU_API_BASE before this script loads.
(function () {
  const AUTH_KEY = "lulu-dengdeng-auth";
  const base = String(window.LULU_API_BASE || "https://api.luludeng.space").replace(/\/+$/, "");

  function url(path) {
    return base + path;
  }

  function currentPage() {
    return (location.pathname.split("/").pop() || "index.html") + location.search;
  }

  function goToLogin() {
    if (/login\.html$/.test(location.pathname)) return;
    try { sessionStorage.removeItem(AUTH_KEY); } catch {}
    location.replace(`login.html?next=${encodeURIComponent(currentPage())}`);
  }

  // Login state lives in Cloudflare Access's cookie on the API domain; every request must carry it.
  // If Access has expired the login, send the visitor back to the login page. Access usually answers
  // an expired login with a redirect to its own login screen, which fetch reports as a network error
  // ("Failed to fetch") rather than a 401 — so after a failed request, check the session before
  // treating it as a connection problem.
  async function request(path, init = {}) {
    let response;
    try {
      response = await fetch(path.startsWith("http") ? path : url(path), { ...init, credentials: "include" });
    } catch (error) {
      if (navigator.onLine !== false && !(await checkSession())) goToLogin();
      throw error;
    }
    if (response.status === 401) goToLogin();
    return response;
  }

  async function checkSession() {
    try {
      const response = await fetch(url("/api/session"), { credentials: "include", cache: "no-store" });
      return response.ok;
    } catch {
      // Not logged in: Access answers with a redirect to its login page, which fetch can't follow.
      return false;
    }
  }

  function loginUrl(returnTo) {
    return url(`/api/login?return=${encodeURIComponent(returnTo)}`);
  }

  function folderOf(src) {
    const parts = String(src).replace(/\\/g, "/").split("/");
    return parts[0] === "assets" && parts.length > 2 ? parts[1] : "";
  }

  // Photos committed to assets/ (photos-manifest.js) plus photos uploaded through the Worker.
  async function loadPhotos() {
    const staticPhotos = (Array.isArray(window.US_PHOTOS) ? window.US_PHOTOS : [])
      .map(photo => ({ ...photo, place: photo.place || folderOf(photo.src), uploaded: false }));
    try {
      const response = await request("/api/photos", { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      const hidden = new Set(Array.isArray(data.hidden) ? data.hidden : []);
      const uploaded = (Array.isArray(data.photos) ? data.photos : [])
        .map(photo => ({ ...photo, uploaded: true }));
      return { online: true, photos: [...staticPhotos.filter(photo => !hidden.has(photo.src)), ...uploaded] };
    } catch {
      return { online: false, photos: staticPhotos };
    }
  }

  async function loadPlaces() {
    try {
      const response = await request("/api/places", { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      return Array.isArray(data.places) ? data.places : [];
    } catch {
      return [];
    }
  }

  async function readJson(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  window.LULU_API = { base, url, request, checkSession, loginUrl, loadPhotos, loadPlaces, readJson, AUTH_KEY };
})();
