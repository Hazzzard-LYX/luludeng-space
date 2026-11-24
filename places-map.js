// Vector map: country/province outlines drawn from geo/*.json, so it stays sharp at every zoom.
(function () {
  const STORAGE_KEY = "lulu-dengdeng-map-pins";
  const HIDDEN_KEY = "lulu-dengdeng-hidden-places";
  const MIN_ZOOM = 2;
  const MAX_ZOOM = 9;
  const CITY_ZOOM = 7;
  const SNAP_PIXELS = 28;
  // Bump when geo/* or this file changes, so browsers skip GitHub Pages' 10-minute cache.
  const ASSET_VERSION = "20261123b";
  let moreCitiesState = "waiting"; // waiting → loading → ready | failed

  const stage = document.getElementById("offline-map-stage");
  const modeLabel = document.getElementById("map-mode");
  const footprintButton = document.getElementById("add-footprint");
  const wishButton = document.getElementById("add-wish");
  const confirmButton = document.getElementById("confirm-location");
  const searchBox = document.querySelector(".city-search");
  const searchInput = document.getElementById("city-search-input");
  const searchResults = document.getElementById("city-results");

  const params = new URLSearchParams(location.search);
  const pendingId = params.get("pending");
  const pendingAddress = params.get("address");

  // "阿坝藏族羌族自治州" → "阿坝" for labels and pin names; the full name stays searchable in `f`.
  const ETHNIC_PREFECTURE = /(蒙古族|蒙古|藏族|羌族|彝族|朝鲜族|土家族|苗族|侗族|布依族|傣族|景颇族|哈尼族|壮族|白族|傈僳族|回族|哈萨克|柯尔克孜)+自治州$/;
  // Each city keeps its normalized names in `k` so searching tens of thousands of places stays quick.
  function withKeys(city) {
    return { ...city, k: [city.n, city.f, city.en].filter(Boolean).map(normalize) };
  }
  const cities = (Array.isArray(window.LULU_CITIES) ? window.LULU_CITIES : [])
    .filter(city => city.n && Number.isFinite(city.lat) && Number.isFinite(city.lng))
    .map(city => ETHNIC_PREFECTURE.test(city.n) ? { ...city, n: city.n.replace(ETHNIC_PREFECTURE, "") || city.n } : city)
    .map(withKeys);

  // geo/cities-more.js (smaller towns, ~600 KB gzipped) loads after the map is on screen.
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

  const map = L.map("offline-map", {
    center: [31, 108],
    zoom: 3,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    zoomSnap: 0.5,
    zoomDelta: 1,
    wheelPxPerZoomLevel: 90,
    zoomControl: false,
    attributionControl: false,
    doubleClickZoom: false,
    worldCopyJump: false,
    maxBounds: [[-75, -240], [85, 240]],
    maxBoundsViscosity: 0.8,
    preferCanvas: true
  });

  // The grid layout can still be settling when this runs. When the real size arrives,
  // resize Leaflet and redraw the canvas from scratch, otherwise only the first-sized strip is painted.
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

  /* ---------- base map ---------- */

  // Outlines that cross the 180° line (Russia's far east, Fiji...) jump from +180 to -180 between
  // two points, which Leaflet draws as a band across the whole map. Shift those points by 360°
  // so each ring stays continuous. Antarctica wraps the whole globe on purpose, so it is left alone.
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

      // China, Taiwan, Hong Kong and Macao come from the more detailed DataV outline instead.
      const replacedByChina = new Set(["156", "158", "344", "446"]);
      const countries = topojson.feature(world, world.objects.countries);
      countries.features = countries.features
        .filter(feature => !replacedByChina.has(String(feature.id)))
        .map(unwrapDateLine);

      L.geoJSON(countries, {
        pane: "land",
        renderer: canvas,
        interactive: false,
        style: { color: "#b7c4aa", weight: 0.7, fillColor: "#f4f2e6", fillOpacity: 1 }
      }).addTo(map);

      L.geoJSON(china, {
        pane: "china",
        renderer: canvas,
        interactive: false,
        style: feature => /Line/.test(feature.geometry.type)
          ? { color: "#9caf8e", weight: 1, fill: false }
          : { color: "#a7b99a", weight: 0.8, fillColor: "#eef2e1", fillOpacity: 1 }
      }).addTo(map);
    } catch (error) {
      console.error("map data failed to load", error);
      modeLabel.textContent = "地图轮廓加载失败，图钉和搜索仍可使用";
      return;
    }
    if (!pendingId && !addingType) modeLabel.textContent = "搜索城市，或点击地图上的城市";
  }

  /* ---------- city dots and labels ---------- */

  const cityLayer = L.layerGroup().addTo(map);

  function minZoomForCity(city) {
    if (city.r === 1) return 3;
    if (city.r === 2) return 4.5;
    if (city.latinOnly) return 8.5; // towns without a Chinese name: searchable, labelled only when fully zoomed in
    if (city.r === 4) return 7.5; // small towns only once you are close in
    return city.en ? 6.5 : 5.5; // Chinese prefecture cities appear before small world cities
  }

  function drawCities() {
    cityLayer.clearLayers();
    const zoom = map.getZoom();
    const bounds = map.getBounds().pad(0.15);
    const candidates = cities
      .filter(city => zoom >= minZoomForCity(city) && bounds.contains([city.lat, city.lng]))
      .sort((a, b) => a.r - b.r || (a.en ? 1 : 0) - (b.en ? 1 : 0));

    // Skip a city when its label would overlap one already placed (more important cities go first).
    const placed = [];
    const visible = [];
    for (const city of candidates) {
      const point = map.latLngToContainerPoint([city.lat, city.lng]);
      const width = city.n.length * 11 + 14;
      const clashes = placed.some(other => point.x < other.x + other.width && other.x < point.x + width && Math.abs(point.y - other.y) < 15);
      if (clashes) continue;
      placed.push({ x: point.x, y: point.y, width });
      visible.push(city);
      if (visible.length >= 220) break;
    }

    visible.forEach(city => {
      const dot = L.circleMarker([city.lat, city.lng], {
        pane: "cities",
        renderer: canvas,
        radius: city.r === 1 ? 3.6 : city.r === 2 ? 3 : city.r === 3 ? 2.4 : 2,
        color: "#f8f6ec",
        weight: 1,
        fillColor: city.r === 1 ? "#5f7653" : "#8a9d7d",
        fillOpacity: 1,
        bubblingMouseEvents: false
      });
      dot.bindTooltip(city.n, {
        permanent: true,
        direction: "right",
        offset: [5, 0],
        className: `city-label rank-${city.r}`,
        interactive: false
      });
      dot.on("click", () => openCity(city));
      cityLayer.addLayer(dot);
    });
  }

  function nearestCity(latlng, maxPixels = SNAP_PIXELS) {
    const point = map.latLngToContainerPoint(latlng);
    let best = null;
    let bestDistance = maxPixels;
    cities.forEach(city => {
      if (map.getZoom() < minZoomForCity(city) - 1) return;
      const distance = map.latLngToContainerPoint([city.lat, city.lng]).distanceTo(point);
      if (distance < bestDistance) {
        best = city;
        bestDistance = distance;
      }
    });
    return best;
  }

  /* ---------- pins ---------- */

  const memories = [
    { name: "上海", lat: 31.2304, lng: 121.4737 },
    { name: "香港", lat: 22.3193, lng: 114.1694 },
    { name: "深圳", lat: 22.5431, lng: 114.0579 }
  ];
  // Pins and hidden places are stored in D1 (/api/pins) so every device sees the same map.
  // Older versions kept them in this browser's localStorage; those are uploaded once (migrateLocalPins).
  let pins = [];
  let hiddenPlaces = new Set();
  let pinsReady = false;
  let markers = [];
  let addingType = null;
  let pendingPoint = null;
  let lastDeleted = null;
  let onlinePlaces = [];

  function readLocal(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function wrapLng(lng) {
    return ((((Number(lng) + 180) % 360) + 360) % 360) - 180;
  }

  async function api(path, init = {}) {
    const response = await window.LULU_API.request(path, init);
    const data = await window.LULU_API.readJson(response);
    if (!response.ok) throw new Error(data.error || "地图图钉暂时无法同步");
    return data;
  }

  function postJson(path, body) {
    return api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }

  async function loadPins() {
    const data = await api("/api/pins", { cache: "no-store" });
    pins = Array.isArray(data.pins) ? data.pins : [];
    hiddenPlaces = new Set(Array.isArray(data.hidden) ? data.hidden : []);
    pinsReady = true;
  }

  async function refreshPins() {
    await loadPins();
    render();
  }

  // Upload pins/hidden places left in this browser by the old localStorage version, then forget them.
  async function migrateLocalPins() {
    const localPins = readLocal(STORAGE_KEY, []);
    const localHidden = readLocal(HIDDEN_KEY, []);
    const hasPins = Array.isArray(localPins) && localPins.length > 0;
    const hasHidden = Array.isArray(localHidden) && localHidden.length > 0;
    if (!hasPins && !hasHidden) return false;
    const samePlace = (a, b) => a.name === b.name && Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(wrapLng(a.lng) - wrapLng(b.lng)) < 1e-4;
    for (const pin of hasPins ? localPins : []) {
      if (!pin || !pin.name || !Number.isFinite(Number(pin.lat)) || !Number.isFinite(Number(pin.lng))) continue;
      const type = pin.type === "footprint" ? "footprint" : "wish";
      if (pins.some(existing => existing.type === type && samePlace(existing, pin))) continue;
      await postJson("/api/pins", { name: String(pin.name).slice(0, 50), type, lat: Number(pin.lat), lng: Number(pin.lng) });
    }
    for (const key of hasHidden ? localHidden : []) {
      if (typeof key === "string" && key && !hiddenPlaces.has(key)) await postJson("/api/pins/hidden", { key });
    }
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(HIDDEN_KEY);
    } catch {}
    return true;
  }

  function footprints() {
    return [...(window.USER_FOOTPRINTS || []), ...onlinePlaces];
  }

  function placeKey(source, place) {
    return `${source}:${place.name}:${Number(place.lat).toFixed(4)}:${Number(place.lng).toFixed(4)}`;
  }

  function updateCount() {
    const visibleMemories = memories.filter(item => !hiddenPlaces.has(placeKey("memory", item))).length;
    const visibleFootprints = footprints().filter(item => !hiddenPlaces.has(placeKey("footprint", item))).length;
    document.getElementById("pin-count").textContent = String(visibleMemories + visibleFootprints + pins.length);
  }

  function pinIcon(type) {
    return L.divIcon({
      className: "offline-pin-wrap",
      html: `<div class="offline-pin ${type}"></div>`,
      iconSize: [24, 34],
      iconAnchor: [12, 32],
      popupAnchor: [0, -29]
    });
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function pinPopup(place, type, source) {
    const box = element("div", "memory-popup");
    box.append(element("small", "", type.includes("wish") ? "OUR WISH" : "OUR FOOTPRINT"), element("b", "", place.name));
    if (source === "pending") {
      box.append(element("span", "", "等待确认位置"));
    } else {
      const link = element("a", "", "打开城市回忆 →");
      link.href = `place.html?name=${encodeURIComponent(place.name)}`;
      box.append(link);
    }
    return box;
  }

  function addMarker(place, type, source, index) {
    const marker = L.marker([place.lat, place.lng], { icon: pinIcon(type), title: place.name, alt: place.name, riseOnHover: true }).addTo(map);
    marker.bindPopup(() => pinPopup(place, type, source));
    marker.on("click", () => {
      if (map.getZoom() < 5) map.flyTo([place.lat, place.lng], 5, { duration: 0.6 });
    });
    if (source !== "pending") {
      marker.on("contextmenu", async event => {
        L.DomEvent.preventDefault(event.originalEvent);
        L.DomEvent.stopPropagation(event.originalEvent);
        if (!confirm(`从地图删除“${place.name}”吗？\n照片文件会保留。`)) return;
        try {
          if (source === "pin") {
            await api(`/api/pins?id=${encodeURIComponent(place.id)}`, { method: "DELETE" });
            lastDeleted = { kind: "pin", id: place.id };
          } else {
            const key = placeKey(source, place);
            await postJson("/api/pins/hidden", { key });
            lastDeleted = { kind: "hidden", key };
          }
          await refreshPins();
          modeLabel.textContent = `已从地图删除 ${place.name}，照片仍保留`;
        } catch (error) {
          modeLabel.textContent = error.message;
        }
      });
    }
    markers.push(marker);
  }

  function render() {
    markers.forEach(marker => marker.remove());
    markers = [];
    memories.forEach((item, index) => {
      if (!hiddenPlaces.has(placeKey("memory", item))) addMarker(item, "footprint", "memory", index);
    });
    footprints().forEach((item, index) => {
      if (!hiddenPlaces.has(placeKey("footprint", item))) addMarker(item, "footprint", "footprint", index);
    });
    pins.forEach((item, index) => addMarker(item, item.type, "pin", index));
    if (pendingPoint) addMarker({ ...pendingPoint, name: pendingPoint.name || "新足迹" }, "footprint pending", "pending", -1);
    updateCount();
  }

  async function addPin(type, name, latlng) {
    if (!pinsReady) {
      modeLabel.textContent = "地图图钉还在同步，请稍后再试";
      return;
    }
    try {
      await postJson("/api/pins", { name, type, lat: latlng.lat, lng: latlng.lng });
      lastDeleted = null;
      await refreshPins();
      modeLabel.textContent = `已添加${type === "footprint" ? "足迹" : "愿望"}：${name}`;
    } catch (error) {
      modeLabel.textContent = error.message;
    }
  }

  /* ---------- choosing a city ---------- */

  function setPending(latlng, name) {
    pendingPoint = { lat: latlng.lat, lng: latlng.lng, name };
    confirmButton.disabled = false;
    modeLabel.textContent = name ? `已选择 ${name}，可以确认足迹` : "位置已选择，可以确认足迹";
    render();
  }

  function openCity(city) {
    const latlng = L.latLng(city.lat, city.lng);
    if (pendingId) {
      setPending(latlng, city.n);
      return;
    }
    if (addingType) {
      addPin(addingType, city.n, latlng);
      setMode(null);
      return;
    }
    const box = element("div", "custom-popup city-popup");
    box.append(element("small", "", city.en ? city.en.toUpperCase() : "CITY"), element("b", "", city.n), element("span", "", city.p || ""));
    const actions = element("div", "city-popup-actions");
    const footprint = element("button", "footprint", "＋ 足迹");
    const wish = element("button", "wish", "＋ 愿望");
    footprint.type = "button";
    wish.type = "button";
    footprint.addEventListener("click", () => { map.closePopup(); addPin("footprint", city.n, latlng); });
    wish.addEventListener("click", () => { map.closePopup(); addPin("wish", city.n, latlng); });
    actions.append(footprint, wish);
    box.append(actions);
    L.popup({ offset: [0, -4], className: "city-popup-wrap" }).setLatLng(latlng).setContent(box).openOn(map);
  }

  function flyToCity(city) {
    const target = Math.max(map.getZoom(), city.r === 1 ? CITY_ZOOM - 1 : CITY_ZOOM);
    map.once("moveend", () => openCity(city));
    map.flyTo([city.lat, city.lng], target, { duration: 0.8 });
  }

  function setMode(type) {
    addingType = type;
    footprintButton.classList.toggle("active", type === "footprint");
    wishButton.classList.toggle("active", type === "wish");
    modeLabel.textContent = type
      ? `点击城市或地图添加${type === "footprint" ? "绿色足迹" : "红色愿望"}`
      : "搜索城市，或点击地图上的城市";
    stage.classList.toggle("adding", Boolean(type));
  }

  footprintButton.addEventListener("click", () => setMode(addingType === "footprint" ? null : "footprint"));
  wishButton.addEventListener("click", () => setMode(addingType === "wish" ? null : "wish"));

  map.on("click", event => {
    const city = nearestCity(event.latlng);
    if (pendingId) {
      setPending(city ? L.latLng(city.lat, city.lng) : event.latlng, city ? city.n : "");
      return;
    }
    if (!addingType) {
      if (city) openCity(city);
      return;
    }
    const suggested = city ? city.n : (addingType === "footprint" ? "我们去过的地方" : "想和你去的地方");
    const name = prompt("给这个地方起一个名字：", suggested);
    if (name && name.trim()) addPin(addingType, name.trim(), city ? L.latLng(city.lat, city.lng) : event.latlng);
    setMode(null);
  });

  document.getElementById("undo-pin").addEventListener("click", async () => {
    if (!pinsReady) return;
    try {
      if (lastDeleted && lastDeleted.kind === "pin") {
        await postJson("/api/pins/restore", { id: lastDeleted.id });
        modeLabel.textContent = "已恢复刚才删除的地点";
      } else if (lastDeleted && lastDeleted.kind === "hidden") {
        await api(`/api/pins/hidden?key=${encodeURIComponent(lastDeleted.key)}`, { method: "DELETE" });
        modeLabel.textContent = "已恢复刚才删除的地点";
      } else if (pins.length) {
        const newest = pins[pins.length - 1];
        await api(`/api/pins?id=${encodeURIComponent(newest.id)}`, { method: "DELETE" });
        modeLabel.textContent = `已撤销：${newest.name}`;
      } else {
        return;
      }
      lastDeleted = null;
      await refreshPins();
    } catch (error) {
      modeLabel.textContent = error.message;
    }
  });

  document.getElementById("clear-pins").addEventListener("click", async () => {
    if (!pinsReady || !pins.length || !confirm("确定清空所有自定义足迹和愿望吗？\n两个人的设备上都会一起清空。")) return;
    try {
      await api("/api/pins?all=1", { method: "DELETE" });
      lastDeleted = null;
      await refreshPins();
      modeLabel.textContent = "已清空自定义足迹和愿望";
    } catch (error) {
      modeLabel.textContent = error.message;
    }
  });

  /* ---------- search ---------- */

  function normalize(value) {
    return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[\s\-_.,，。·'’]+/g, "").replace(/(特别行政区|自治州|地区|市|省)$/, "");
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

  let results = [];
  let activeResult = -1;

  function setResultsOpen(open) {
    searchResults.hidden = !open;
    searchBox.setAttribute("aria-expanded", String(open));
  }

  function showResults(list) {
    results = list;
    activeResult = list.length ? 0 : -1;
    searchResults.innerHTML = "";
    list.forEach((city, index) => {
      const item = element("li", index === 0 ? "active" : "");
      item.setAttribute("role", "option");
      item.append(element("b", "", city.n), element("span", "", city.en ? `${city.p} · ${city.en}` : city.p));
      item.addEventListener("mousedown", event => {
        event.preventDefault();
        chooseResult(index);
      });
      searchResults.append(item);
    });
    if (!list.length && searchInput.value.trim()) {
      const message = moreCitiesState === "ready" || moreCitiesState === "failed"
        ? "没有找到这个城市，可以试试英文名，或直接在地图上点击位置"
        : "小城市数据还在加载，请稍候…";
      searchResults.append(element("li", "empty", message));
    }
    setResultsOpen(Boolean(searchInput.value.trim()));
  }

  function highlight(index) {
    activeResult = index;
    [...searchResults.children].forEach((item, itemIndex) => item.classList.toggle("active", itemIndex === index));
  }

  function chooseResult(index) {
    const city = results[index];
    if (!city) return;
    searchInput.value = city.n;
    setResultsOpen(false);
    searchInput.blur();
    flyToCity(city);
  }

  searchInput.addEventListener("input", () => showResults(searchCities(searchInput.value)));
  searchInput.addEventListener("focus", () => { if (searchInput.value.trim()) showResults(searchCities(searchInput.value)); });
  searchInput.addEventListener("blur", () => setTimeout(() => setResultsOpen(false), 120));
  searchInput.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" && results.length) { event.preventDefault(); highlight((activeResult + 1) % results.length); }
    else if (event.key === "ArrowUp" && results.length) { event.preventDefault(); highlight((activeResult - 1 + results.length) % results.length); }
    else if (event.key === "Enter") { event.preventDefault(); chooseResult(Math.max(0, activeResult)); }
    else if (event.key === "Escape") { setResultsOpen(false); searchInput.blur(); }
  });

  /* ---------- zoom ---------- */

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

  /* ---------- photo waiting for a location ---------- */

  // Place the pin for the uploaded photo when its address names a known city. Returns true if it did.
  function autoPlacePending() {
    if (!pendingId || !pendingAddress || pendingPoint) return false;
    const match = searchCities(pendingAddress, 1)[0];
    if (!match || !match.k.includes(normalize(pendingAddress))) return false;
    map.setView([match.lat, match.lng], CITY_ZOOM - 1);
    setPending(L.latLng(match.lat, match.lng), match.n);
    document.getElementById("pending-hint").textContent = `已根据地址找到“${match.n}”（${match.p}）。不对的话，可以重新搜索或在地图上点击。`;
    return true;
  }

  if (pendingId) {
    document.getElementById("pending-guide").hidden = false;
    document.getElementById("pending-address").textContent = pendingAddress || "新的地点";
    document.querySelector(".map-actions").hidden = true;
    stage.classList.add("adding");
    if (!autoPlacePending()) {
      modeLabel.textContent = "搜索城市，或在地图上点击位置";
      if (pendingAddress) searchInput.value = pendingAddress;
    }

    confirmButton.addEventListener("click", async () => {
      if (!pendingPoint) return;
      confirmButton.disabled = true;
      confirmButton.textContent = "正在保存…";
      let response;
      let result = {};
      try {
        response = await window.LULU_API.request("/api/photos/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pendingId, lat: pendingPoint.lat, lng: pendingPoint.lng })
        });
        result = await window.LULU_API.readJson(response);
      } catch {
        result = { error: "无法连接照片服务，请检查网络后再试。" };
      }
      if (!response || !response.ok) {
        confirmButton.disabled = false;
        confirmButton.textContent = "确认足迹并保存照片 →";
        alert(result.error || "保存失败");
        return;
      }
      location.replace("us.html");
    });
  }

  /* ---------- start ---------- */

  render();
  updateZoom();
  drawCities();
  loadBaseMap().then(loadMoreCities).then(loaded => {
    if (!loaded) return;
    drawCities();
    autoPlacePending();
    if (document.activeElement === searchInput && searchInput.value.trim()) showResults(searchCities(searchInput.value));
  });
  loadPins()
    .then(async () => {
      if (await migrateLocalPins()) await loadPins();
      render();
    })
    .catch(error => {
      modeLabel.textContent = error.message || "地图图钉暂时无法同步";
    });
  // Pick up pins added on the other device when coming back to this tab.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && pinsReady) refreshPins().catch(() => {});
  });
  window.LULU_API.loadPlaces().then(places => {
    onlinePlaces = places.filter(place => Number.isFinite(Number(place.lat)) && Number.isFinite(Number(place.lng)));
    if (onlinePlaces.length) render();
  });
})();
