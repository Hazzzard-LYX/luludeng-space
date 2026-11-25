// 美食地图: places we ate, stored in D1 (/api/food) with photos in R2. Spots are pinned at their city,
// so spots in the same city share one map marker (a round photo with a count).
// The vector base map and city search follow places-map.js.
(function () {
  const MIN_ZOOM = 2;
  const MAX_ZOOM = 9;
  const CITY_ZOOM = 7;
  const SNAP_PIXELS = 28;
  const MAX_PHOTOS = 9;
  const PHOTO_MAX_SIDE = 1600;
  const ASSET_VERSION = "20261123b";
  const api = window.LULU_API;

  const stage = document.getElementById("food-map-stage");
  const modeLabel = document.getElementById("map-mode");
  const listEl = document.getElementById("food-list");
  const detail = document.getElementById("food-detail");
  const formDialog = document.getElementById("food-form-dialog");
  const form = document.getElementById("food-form");
  const formStatus = document.getElementById("food-form-status");
  const searchBox = document.querySelector(".food-city-search");
  const searchInput = document.getElementById("city-search-input");
  const searchResults = document.getElementById("city-results");
  const pickedLabel = document.getElementById("food-city-picked");
  const photoInput = document.getElementById("food-photos");
  const photoGrid = document.getElementById("food-photo-grid");

  let spots = [];
  let ready = false;
  let filterKey = null; // show only the spots of one map marker
  let editing = null; // spot being edited, or null for a new one
  let picked = null; // { city, lat, lng } chosen for the form
  let rating = 0;
  let newPhotos = []; // { file, url }
  let pickingOnMap = false;
  let moreCitiesState = "waiting";

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function groupKey(spot) {
    return `${Number(spot.lat).toFixed(2)},${Number(spot.lng).toFixed(2)}`;
  }

  function formatDate(value) {
    return value ? value.replace(/-/g, ".") : "";
  }

  // Read-only stars with half-star fill, e.g. 3.5 → three full, one half, one empty.
  function starRow(value) {
    const row = el("span", "food-star-row");
    row.setAttribute("aria-label", `${value} 颗星`);
    for (let index = 0; index < 5; index += 1) {
      const star = el("span", "food-star");
      const fill = el("span", "food-star-fill");
      fill.style.width = `${Math.max(0, Math.min(1, value - index)) * 100}%`;
      star.append(fill);
      row.append(star);
    }
    row.append(el("small", "", String(value)));
    return row;
  }

  async function call(path, init = {}) {
    const response = await api.request(path, init);
    const data = await api.readJson(response);
    if (!response.ok) throw new Error(data.error || "没有保存成功，请稍后再试");
    return data;
  }

  function postJson(path, body) {
    return call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }

  /* ---------- cities and search ---------- */

  const ETHNIC_PREFECTURE = /(蒙古族|蒙古|藏族|羌族|彝族|朝鲜族|土家族|苗族|侗族|布依族|傣族|景颇族|哈尼族|壮族|白族|傈僳族|回族|哈萨克|柯尔克孜)+自治州$/;

  function normalize(value) {
    return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[\s\-_.,，。·'’]+/g, "").replace(/(特别行政区|自治州|地区|市|省)$/, "");
  }

  function withKeys(city) {
    return { ...city, k: [city.n, city.f, city.en].filter(Boolean).map(normalize) };
  }

  const cities = (Array.isArray(window.LULU_CITIES) ? window.LULU_CITIES : [])
    .filter(city => city.n && Number.isFinite(city.lat) && Number.isFinite(city.lng))
    .map(city => ETHNIC_PREFECTURE.test(city.n) ? { ...city, n: city.n.replace(ETHNIC_PREFECTURE, "") || city.n } : city)
    .map(withKeys);

  function loadMoreCities() {
    return new Promise(resolve => {
      const script = document.createElement("script");
      moreCitiesState = "loading";
      script.src = `geo/cities-more.js?v=${ASSET_VERSION}`;
      script.async = true;
      script.onload = () => {
        const data = window.LULU_CITIES_MORE;
        if (data && Array.isArray(data.d)) {
          data.d.forEach(([zh, en, country, lat, lng, thousands]) => {
            cities.push(withKeys({ n: zh || en, en, p: data.c[country] || country, lat, lng, r: thousands >= 100 ? 3 : 4, latinOnly: !zh }));
          });
        }
        delete window.LULU_CITIES_MORE;
        moreCitiesState = "ready";
        resolve(true);
      };
      script.onerror = () => { moreCitiesState = "failed"; resolve(false); };
      document.head.append(script);
    });
  }

  function searchCities(query, limit = 8) {
    const wanted = normalize(query);
    if (!wanted) return [];
    const scored = [];
    cities.forEach(city => {
      let score = Infinity;
      city.k.forEach(name => {
        if (name === wanted) score = Math.min(score, 0);
        else if (name.startsWith(wanted)) score = Math.min(score, 1);
        else if (name.includes(wanted)) score = Math.min(score, 2);
      });
      if (score < Infinity) scored.push({ city, score: score * 10 + city.r });
    });
    return scored.sort((a, b) => a.score - b.score).slice(0, limit).map(item => item.city);
  }

  /* ---------- map ---------- */

  const map = L.map("offline-map", {
    center: [31, 112], zoom: 3, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, zoomSnap: 0.5, zoomDelta: 1,
    wheelPxPerZoomLevel: 90, zoomControl: false, attributionControl: false, doubleClickZoom: false,
    worldCopyJump: false, maxBounds: [[-75, -240], [85, 240]], maxBoundsViscosity: 0.8, preferCanvas: true
  });

  let lastSize = map.getSize();
  let resizeFrame = 0;
  function syncSize() {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      map.invalidateSize({ pan: false });
      const size = map.getSize();
      if (size.equals(lastSize)) return;
      lastSize = size;
      map.setView(map.getCenter(), map.getZoom(), { animate: false, reset: true });
    });
  }
  if ("ResizeObserver" in window) new ResizeObserver(syncSize).observe(map.getContainer());
  window.addEventListener("resize", syncSize);
  window.addEventListener("load", syncSize);
  map.createPane("land").style.zIndex = 200;
  map.createPane("china").style.zIndex = 250;
  map.createPane("cities").style.zIndex = 350;
  const canvas = L.canvas({ padding: 0.4 });

  function unwrapRing(ring) {
    let offset = 0;
    return ring.map(([lng, lat], index) => {
      if (index > 0) {
        const previous = ring[index - 1][0];
        if (lng - previous > 180) offset -= 360;
        else if (previous - lng > 180) offset += 360;
      }
      return [lng + offset, lat];
    });
  }

  function unwrapDateLine(feature) {
    if (String(feature.id) === "010" || !feature.geometry) return feature;
    const { type, coordinates } = feature.geometry;
    if (type === "Polygon") feature.geometry.coordinates = coordinates.map(unwrapRing);
    if (type === "MultiPolygon") feature.geometry.coordinates = coordinates.map(polygon => polygon.map(unwrapRing));
    return feature;
  }

  async function loadBaseMap() {
    try {
      const [world, china] = await Promise.all([
        fetch(`geo/world-50m.json?v=${ASSET_VERSION}`).then(response => response.json()),
        fetch(`geo/china.json?v=${ASSET_VERSION}`).then(response => response.json())
      ]);
      const replacedByChina = new Set(["156", "158", "344", "446"]);
      const countries = topojson.feature(world, world.objects.countries);
      countries.features = countries.features.filter(feature => !replacedByChina.has(String(feature.id))).map(unwrapDateLine);
      L.geoJSON(countries, { pane: "land", renderer: canvas, interactive: false, style: { color: "#b7c4aa", weight: 0.7, fillColor: "#f4f2e6", fillOpacity: 1 } }).addTo(map);
      L.geoJSON(china, {
        pane: "china", renderer: canvas, interactive: false,
        style: feature => /Line/.test(feature.geometry.type)
          ? { color: "#9caf8e", weight: 1, fill: false }
          : { color: "#a7b99a", weight: 0.8, fillColor: "#eef2e1", fillOpacity: 1 }
      }).addTo(map);
    } catch (error) {
      console.error("map data failed to load", error);
      modeLabel.textContent = "地图轮廓加载失败，美食记录仍可使用";
      return;
    }
    if (!pickingOnMap) modeLabel.textContent = "点击地图上的美食，看看我们吃过什么";
  }

  const cityLayer = L.layerGroup().addTo(map);

  function minZoomForCity(city) {
    if (city.r === 1) return 3;
    if (city.r === 2) return 4.5;
    if (city.latinOnly) return 8.5;
    if (city.r === 4) return 7.5;
    return city.en ? 6.5 : 5.5;
  }

  function drawCities() {
    cityLayer.clearLayers();
    const zoom = map.getZoom();
    const bounds = map.getBounds().pad(0.15);
    const candidates = cities
      .filter(city => zoom >= minZoomForCity(city) && bounds.contains([city.lat, city.lng]))
      .sort((a, b) => a.r - b.r || (a.en ? 1 : 0) - (b.en ? 1 : 0));
    const placed = [];
    let shown = 0;
    for (const city of candidates) {
      const point = map.latLngToContainerPoint([city.lat, city.lng]);
      const width = city.n.length * 11 + 14;
      if (placed.some(other => point.x < other.x + other.width && other.x < point.x + width && Math.abs(point.y - other.y) < 15)) continue;
      placed.push({ x: point.x, y: point.y, width });
      const dot = L.circleMarker([city.lat, city.lng], {
        pane: "cities", renderer: canvas, radius: city.r === 1 ? 3.2 : 2.4, color: "#f8f6ec", weight: 1,
        fillColor: city.r === 1 ? "#5f7653" : "#8a9d7d", fillOpacity: 1, interactive: false
      });
      dot.bindTooltip(city.n, { permanent: true, direction: "right", offset: [5, 0], className: `city-label rank-${city.r}`, interactive: false });
      cityLayer.addLayer(dot);
      if (++shown >= 220) break;
    }
  }

  function nearestCity(latlng) {
    const point = map.latLngToContainerPoint(latlng);
    let best = null;
    let bestDistance = SNAP_PIXELS;
    cities.forEach(city => {
      if (map.getZoom() < minZoomForCity(city) - 1) return;
      const distance = map.latLngToContainerPoint([city.lat, city.lng]).distanceTo(point);
      if (distance < bestDistance) { best = city; bestDistance = distance; }
    });
    return best;
  }

  function updateZoom() {
    const zoom = map.getZoom();
    document.getElementById("zoom-label").textContent = zoom < 3.5 ? "世界" : zoom < 5.5 ? "区域" : "城市";
    document.getElementById("zoom-out").disabled = zoom <= MIN_ZOOM;
    document.getElementById("zoom-in").disabled = zoom >= MAX_ZOOM;
  }
  document.getElementById("zoom-in").addEventListener("click", () => map.zoomIn(1));
  document.getElementById("zoom-out").addEventListener("click", () => map.zoomOut(1));
  map.on("zoomend", updateZoom);
  map.on("moveend", drawCities);

  /* ---------- markers ---------- */

  const markerLayer = L.layerGroup().addTo(map);

  function groups() {
    const byKey = new Map();
    spots.forEach(spot => {
      const key = groupKey(spot);
      if (!byKey.has(key)) byKey.set(key, { key, lat: spot.lat, lng: spot.lng, city: spot.city, spots: [] });
      byKey.get(key).spots.push(spot);
    });
    return [...byKey.values()];
  }

  function drawMarkers() {
    markerLayer.clearLayers();
    groups().forEach(group => {
      // A small green dot per city; the name and count show on hover.
      const active = filterKey === group.key;
      const marker = L.marker([group.lat, group.lng], {
        icon: L.divIcon({ className: "food-dot-wrap", html: `<span class="food-dot${active ? " active" : ""}"></span>`, iconSize: [20, 20], iconAnchor: [10, 10] }),
        keyboard: true,
        riseOnHover: true
      });
      const names = group.spots.slice(0, 3).map(spot => spot.name).join("、") + (group.spots.length > 3 ? " …" : "");
      marker.bindTooltip(`${group.city} · ${group.spots.length} 家：${names}`, { direction: "top", offset: [0, -8], className: "food-dot-tip" });
      marker.on("click", () => {
        if (pickingOnMap) return;
        setFilter(group.key);
        if (group.spots.length === 1) openDetail(group.spots[0]);
      });
      markerLayer.addLayer(marker);
    });
  }

  /* ---------- list ---------- */

  function setFilter(key) {
    filterKey = key;
    const group = key && groups().find(item => item.key === key);
    document.getElementById("food-filter").hidden = !group;
    if (group) document.getElementById("food-filter-label").textContent = `${group.city} · ${group.spots.length} 家`;
    renderList();
    drawMarkers();
  }
  document.getElementById("food-filter-clear").addEventListener("click", () => setFilter(null));

  function renderList() {
    const shown = filterKey ? spots.filter(spot => groupKey(spot) === filterKey) : spots;
    document.getElementById("food-count").textContent = String(spots.length);
    document.getElementById("food-city-count").textContent = String(new Set(spots.map(spot => spot.city)).size);
    if (!ready) return;
    if (!shown.length) {
      listEl.replaceChildren(el("li", "food-empty", "还没有记下吃过的店。点“＋ 记一家店”，把第一顿好吃的放上地图吧。"));
      return;
    }
    listEl.replaceChildren(...shown.map(spot => {
      const item = el("li");
      const button = el("button", "food-item");
      button.type = "button";
      const thumb = el("span", "food-thumb");
      if (spot.photos[0]) {
        const img = el("img");
        img.src = spot.photos[0].src;
        img.alt = "";
        img.loading = "lazy";
        thumb.append(img);
      } else thumb.append(el("i", "", "食"));
      const text = el("span", "food-item-text");
      text.append(el("b", "", spot.name), el("small", "", [spot.city, formatDate(spot.visited_on)].filter(Boolean).join(" · ")));
      if (spot.rating) text.append(starRow(spot.rating));
      button.append(thumb, text);
      if (spot.photos.length > 1) button.append(el("span", "food-item-count", `${spot.photos.length} 张`));
      button.addEventListener("click", () => {
        map.flyTo([spot.lat, spot.lng], Math.max(map.getZoom(), 5.5), { duration: 0.6 });
        openDetail(spot);
      });
      item.append(button);
      return item;
    }));
  }

  /* ---------- detail ---------- */

  let detailSpot = null;

  function openDetail(spot) {
    detailSpot = spot;
    document.getElementById("detail-city").textContent = [spot.city, spot.address].filter(Boolean).join(" · ");
    document.getElementById("detail-name").textContent = spot.name;
    const who = { lulu: "噜噜", dengdeng: "噔噔" }[spot.created_by];
    const meta = document.getElementById("detail-meta");
    meta.replaceChildren();
    if (spot.rating) meta.append(starRow(spot.rating));
    const metaText = [formatDate(spot.visited_on), who ? `${who}记的` : ""].filter(Boolean).join("　");
    if (metaText) meta.append(el("span", "", metaText));
    document.getElementById("detail-note").textContent = spot.note || "";
    const photos = document.getElementById("detail-photos");
    photos.replaceChildren();
    photos.hidden = !spot.photos.length;
    if (spot.photos.length) {
      const main = el("img", "detail-main");
      main.src = spot.photos[0].src;
      main.alt = spot.name;
      photos.append(main);
      if (spot.photos.length > 1) {
        const strip = el("div", "detail-strip");
        spot.photos.forEach((photo, index) => {
          const thumb = el("button", index === 0 ? "active" : "");
          thumb.type = "button";
          thumb.setAttribute("aria-label", `第 ${index + 1} 张照片`);
          const img = el("img");
          img.src = photo.src;
          img.alt = "";
          img.loading = "lazy";
          thumb.append(img);
          thumb.addEventListener("click", () => {
            main.src = photo.src;
            strip.querySelectorAll("button").forEach(other => other.classList.toggle("active", other === thumb));
          });
          strip.append(thumb);
        });
        photos.append(strip);
      }
    }
    if (!detail.open) detail.showModal();
  }

  document.getElementById("detail-edit").addEventListener("click", () => {
    const spot = detailSpot;
    detail.close();
    if (spot) openForm(spot);
  });

  document.getElementById("detail-delete").addEventListener("click", async () => {
    const spot = detailSpot;
    if (!spot || !confirm(`删除“${spot.name}”吗？\n它的照片也会一起从美食地图上消失。`)) return;
    try {
      await call(`/api/food?id=${encodeURIComponent(spot.id)}`, { method: "DELETE" });
      detail.close();
      await refresh();
      modeLabel.textContent = `已删除 ${spot.name}`;
    } catch (error) {
      alert(error.message);
    }
  });

  /* ---------- form ---------- */

  // Five stars, each split into a left half (x.5) and a right half (whole star).
  // Clicking the current value again clears the rating.
  const starBox = document.getElementById("food-stars");
  const starValue = el("span", "food-stars-value");
  for (let index = 0; index < 5; index += 1) {
    const star = el("span", "food-star-input");
    star.append(el("span", "food-star-fill"));
    [index + 0.5, index + 1].forEach((value, half) => {
      const button = el("button", half ? "right" : "left");
      button.type = "button";
      button.setAttribute("role", "radio");
      button.setAttribute("aria-label", `${value} 颗星`);
      button.dataset.value = String(value);
      button.addEventListener("click", () => setRating(rating === value ? 0 : value));
      button.addEventListener("mouseenter", () => paintStars(value));
      star.append(button);
    });
    starBox.append(star);
  }
  starBox.append(starValue);
  starBox.addEventListener("mouseleave", () => paintStars(rating));

  function paintStars(value) {
    [...starBox.querySelectorAll(".food-star-fill")].forEach((fill, index) => {
      fill.style.width = `${Math.max(0, Math.min(1, value - index)) * 100}%`;
    });
    starValue.textContent = value ? `${value} 星` : "";
  }

  function setRating(value) {
    rating = value;
    starBox.querySelectorAll("button").forEach(button => button.setAttribute("aria-checked", String(Number(button.dataset.value) === value)));
    paintStars(value);
  }

  function today() {
    const now = new Date();
    const pad = number => String(number).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function setPicked(value) {
    picked = value;
    pickedLabel.hidden = !value;
    if (value) {
      pickedLabel.textContent = `✓ 位置：${value.city}`;
      searchInput.value = value.city;
    }
  }

  function openForm(spot) {
    editing = spot || null;
    newPhotos.forEach(photo => URL.revokeObjectURL(photo.url));
    newPhotos = [];
    form.reset();
    formStatus.textContent = "";
    document.getElementById("form-title").textContent = spot ? "编辑这家店" : "记一家店";
    document.getElementById("food-submit").textContent = spot ? "保存修改" : "保存";
    document.getElementById("food-submit").disabled = false;
    document.getElementById("food-name").value = spot ? spot.name : "";
    document.getElementById("food-address").value = spot ? spot.address || "" : "";
    document.getElementById("food-note").value = spot ? spot.note || "" : "";
    document.getElementById("food-date").value = spot ? spot.visited_on || "" : today();
    setRating(spot ? spot.rating || 0 : 0);
    setPicked(spot ? { city: spot.city, lat: spot.lat, lng: spot.lng } : null);
    if (!spot) searchInput.value = "";
    renderPhotoGrid();
    formDialog.showModal();
    if (!spot) document.getElementById("food-name").focus();
  }

  document.getElementById("food-add").addEventListener("click", () => {
    if (!ready) return;
    const group = filterKey && groups().find(item => item.key === filterKey);
    openForm(null);
    if (group) setPicked({ city: group.city, lat: group.lat, lng: group.lng });
  });

  function renderPhotoGrid() {
    const existing = editing ? editing.photos : [];
    const total = existing.length + newPhotos.length;
    photoGrid.replaceChildren();
    existing.forEach(photo => {
      const tile = el("span", "food-photo-tile");
      const img = el("img");
      img.src = photo.src;
      img.alt = "";
      const remove = el("button", "", "×");
      remove.type = "button";
      remove.setAttribute("aria-label", "删除这张照片");
      remove.addEventListener("click", async () => {
        if (!confirm("删除这张照片吗？")) return;
        try {
          await call(`/api/food/photos?id=${encodeURIComponent(photo.id)}`, { method: "DELETE" });
          editing.photos = editing.photos.filter(other => other.id !== photo.id);
          renderPhotoGrid();
          refresh().catch(() => {});
        } catch (error) {
          formStatus.textContent = error.message;
        }
      });
      tile.append(img, remove);
      photoGrid.append(tile);
    });
    newPhotos.forEach((photo, index) => {
      const tile = el("span", "food-photo-tile new");
      const img = el("img");
      img.src = photo.url;
      img.alt = "";
      const remove = el("button", "", "×");
      remove.type = "button";
      remove.setAttribute("aria-label", "不要这张照片");
      remove.addEventListener("click", () => {
        URL.revokeObjectURL(photo.url);
        newPhotos.splice(index, 1);
        renderPhotoGrid();
      });
      tile.append(img, remove);
      photoGrid.append(tile);
    });
    document.getElementById("food-photo-pick").hidden = total >= MAX_PHOTOS;
    document.getElementById("food-photo-limit").textContent = `（${total} / ${MAX_PHOTOS}）`;
  }

  function isImage(file) {
    return file.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i.test(file.name);
  }

  function addPhotos(fileList) {
    const room = MAX_PHOTOS - (editing ? editing.photos.length : 0) - newPhotos.length;
    const all = [...fileList];
    const files = all.filter(isImage);
    files.slice(0, Math.max(0, room)).forEach(file => newPhotos.push({ file, url: URL.createObjectURL(file) }));
    formStatus.textContent = files.length > room ? `每家店最多 ${MAX_PHOTOS} 张，多出来的没有加上。`
      : files.length < all.length ? "有些文件不是照片，没有加上。" : "";
    renderPhotoGrid();
  }

  photoInput.addEventListener("change", () => {
    addPhotos(photoInput.files);
    photoInput.value = "";
  });

  /* ---------- drag and drop (desktop) ---------- */
  // Photos dragged onto the open form are added to it; dragged onto the page, they start a new spot.
  const photoPick = document.getElementById("food-photo-pick");
  const dropHint = matchMedia("(hover:hover) and (pointer:fine)").matches;
  if (dropHint) photoPick.firstChild.textContent = "＋ 选择或拖入照片";
  const hasFiles = event => [...(event.dataTransfer?.types || [])].includes("Files");
  let dragDepth = 0;
  function setDragging(on) {
    document.body.classList.toggle("photo-dragging", on);
    photoPick.classList.toggle("dragover", on);
  }
  window.addEventListener("dragenter", event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (dragDepth++ === 0) setDragging(true);
  });
  window.addEventListener("dragover", event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = ready && !pickingOnMap ? "copy" : "none";
  });
  window.addEventListener("dragleave", event => {
    if (!hasFiles(event)) return;
    if (--dragDepth <= 0) { dragDepth = 0; setDragging(false); }
  });
  window.addEventListener("drop", event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    setDragging(false);
    if (!ready || pickingOnMap) return;
    const files = [...event.dataTransfer.files];
    // Onto a spot's detail: add the photos to that spot. Onto the page: start a new spot.
    if (detail.open) document.getElementById("detail-edit").click();
    else if (!formDialog.open) document.getElementById("food-add").click();
    addPhotos(files);
  });

  // Phone photos are often 5-10 MB; shrink to at most 1600 px JPEG before uploading.
  async function preparePhoto(file) {
    if (file.type === "image/gif") return file;
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      const width = Math.round(bitmap.width * scale);
      const height = Math.round(bitmap.height * scale);
      const canvasEl = document.createElement("canvas");
      canvasEl.width = width;
      canvasEl.height = height;
      canvasEl.getContext("2d").drawImage(bitmap, 0, 0, width, height);
      bitmap.close?.();
      const blob = await new Promise(resolve => canvasEl.toBlob(resolve, "image/jpeg", 0.85));
      if (!blob) throw new Error("encode failed");
      return new File([blob], `${(file.name || "photo").replace(/\.[^.]+$/, "") || "photo"}.jpg`, { type: "image/jpeg" });
    } catch {
      return file; // the server checks the format
    }
  }

  async function uploadPhotos(spotId) {
    let failed = 0;
    for (let index = 0; index < newPhotos.length; index += 1) {
      formStatus.textContent = `正在上传照片 ${index + 1} / ${newPhotos.length}…`;
      try {
        const file = await preparePhoto(newPhotos[index].file);
        await call(`/api/food/photos?spot=${encodeURIComponent(spotId)}&filename=${encodeURIComponent(file.name)}`, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file
        });
      } catch (error) {
        failed += 1;
        console.error("food photo upload failed", error);
      }
    }
    return failed;
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const name = document.getElementById("food-name").value.trim();
    if (!name) { formStatus.textContent = "请写上店名。"; document.getElementById("food-name").focus(); return; }
    if (!picked) { formStatus.textContent = "请搜索并选择城市，或在地图上点选位置。"; searchInput.focus(); return; }
    const submit = document.getElementById("food-submit");
    submit.disabled = true;
    formStatus.textContent = "正在保存…";
    const fields = {
      name,
      city: picked.city,
      lat: picked.lat,
      lng: picked.lng,
      address: document.getElementById("food-address").value.trim(),
      note: document.getElementById("food-note").value.trim(),
      rating: rating || null,
      visited_on: document.getElementById("food-date").value || null
    };
    try {
      let spotId;
      if (editing) {
        await postJson("/api/food/update", { id: editing.id, ...fields });
        spotId = editing.id;
      } else {
        spotId = (await postJson("/api/food", fields)).spot.id;
      }
      const failed = newPhotos.length ? await uploadPhotos(spotId) : 0;
      await refresh();
      const saved = spots.find(spot => spot.id === spotId);
      if (failed) {
        formStatus.textContent = `店已保存，但有 ${failed} 张照片没传上去，可以稍后在“编辑”里再加。`;
        editing = saved || editing;
        newPhotos = [];
        renderPhotoGrid();
        submit.disabled = false;
        return;
      }
      formDialog.close();
      if (saved) {
        setFilter(groupKey(saved));
        map.flyTo([saved.lat, saved.lng], Math.max(map.getZoom(), 5.5), { duration: 0.6 });
        openDetail(saved);
      }
    } catch (error) {
      formStatus.textContent = error.message;
      submit.disabled = false;
    }
  });

  /* ---------- city search inside the form ---------- */

  let results = [];
  let activeResult = -1;

  function setResultsOpen(open) {
    searchResults.hidden = !open;
    searchBox.setAttribute("aria-expanded", String(open));
  }

  function showResults(list) {
    results = list;
    activeResult = list.length ? 0 : -1;
    searchResults.replaceChildren();
    list.forEach((city, index) => {
      const item = el("li", index === 0 ? "active" : "");
      item.setAttribute("role", "option");
      item.append(el("b", "", city.n), el("span", "", city.en ? `${city.p} · ${city.en}` : city.p));
      item.addEventListener("mousedown", event => { event.preventDefault(); chooseResult(index); });
      searchResults.append(item);
    });
    if (!list.length && searchInput.value.trim()) {
      const message = moreCitiesState === "ready" || moreCitiesState === "failed"
        ? "没有找到这个城市，可以试试英文名，或在地图上点选位置"
        : "小城市数据还在加载，请稍候…";
      searchResults.append(el("li", "empty", message));
    }
    setResultsOpen(Boolean(searchInput.value.trim()));
  }

  function chooseResult(index) {
    const city = results[index];
    if (!city) return;
    setPicked({ city: city.n, lat: city.lat, lng: city.lng });
    setResultsOpen(false);
  }

  searchInput.addEventListener("input", () => {
    if (picked && searchInput.value.trim() !== picked.city) setPicked(null);
    showResults(searchCities(searchInput.value));
  });
  searchInput.addEventListener("blur", () => setTimeout(() => setResultsOpen(false), 120));
  searchInput.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" && results.length) { event.preventDefault(); activeResult = (activeResult + 1) % results.length; }
    else if (event.key === "ArrowUp" && results.length) { event.preventDefault(); activeResult = (activeResult - 1 + results.length) % results.length; }
    else if (event.key === "Enter") { event.preventDefault(); chooseResult(Math.max(0, activeResult)); return; }
    else if (event.key === "Escape" && !searchResults.hidden) { event.preventDefault(); setResultsOpen(false); return; }
    else return;
    [...searchResults.children].forEach((item, index) => item.classList.toggle("active", index === activeResult));
  });

  // Small places missing from the city list: close the form, let them click the map, then come back.
  document.getElementById("pick-on-map").addEventListener("click", () => {
    pickingOnMap = true;
    formDialog.close();
    stage.classList.add("adding");
    modeLabel.textContent = "点击地图选择这家店所在的位置（按 Esc 取消）";
    stage.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  function stopPicking() {
    pickingOnMap = false;
    stage.classList.remove("adding");
    modeLabel.textContent = "点击地图上的美食，看看我们吃过什么";
    formDialog.showModal();
  }

  map.on("click", event => {
    if (!pickingOnMap) return;
    const city = nearestCity(event.latlng);
    const name = city ? city.n : (prompt("这个地方叫什么？", "") || "").trim();
    if (!name) return;
    const point = city ? L.latLng(city.lat, city.lng) : event.latlng;
    setPicked({ city: name.slice(0, 50), lat: point.lat, lng: point.lng });
    stopPicking();
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && pickingOnMap) stopPicking();
  });

  [detail, formDialog].forEach(dialog => {
    dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
    // Click on the backdrop closes the dialog.
    dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  });

  /* ---------- data ---------- */

  async function refresh() {
    const data = await call("/api/food", { cache: "no-store" });
    spots = Array.isArray(data.spots) ? data.spots : [];
    ready = true;
    if (filterKey && !spots.some(spot => groupKey(spot) === filterKey)) filterKey = null;
    setFilter(filterKey);
  }

  /* ---------- start ---------- */

  updateZoom();
  drawCities();
  loadBaseMap().then(loadMoreCities).then(loaded => { if (loaded) drawCities(); });
  refresh().catch(error => {
    listEl.replaceChildren(el("li", "food-empty", error.message || "美食地图暂时打不开，请稍后再试。"));
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && ready && !formDialog.open) refresh().catch(() => {});
  });
})();
