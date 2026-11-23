const wall = document.getElementById("photo-loop");
const total = document.getElementById("stream-total");
const api = window.LULU_API;
let photoServiceOnline = false;

wall.addEventListener("pointerover", event => { if (event.target.closest("figure")) wall.classList.add("photo-hovered"); });
wall.addEventListener("pointerout", event => {
  const figure = event.target.closest("figure");
  if (figure && !figure.contains(event.relatedTarget)) wall.classList.remove("photo-hovered");
});

function seed(text) {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return Math.abs(value);
}

async function buildGallery() {
  const { online, photos } = await api.loadPhotos();
  photoServiceOnline = online;
  setUploadAvailability();

  const ordered = [...photos].sort((a, b) => seed(a.src) - seed(b.src));
  const columnCount = matchMedia("(max-width:760px)").matches ? 3 : 5;
  const columns = Array.from({ length: columnCount }, (_, index) => {
    const column = document.createElement("section"), track = document.createElement("div"), set = document.createElement("div");
    column.className = "moving-column";
    track.className = "column-track";
    set.className = "column-set";
    column.style.setProperty("--column-width", `${index % 2 ? 1.06 : .94}fr`);
    track.appendChild(set);
    column.appendChild(track);
    wall.appendChild(column);
    return { track, set, images: [] };
  });
  total.textContent = String(ordered.length).padStart(2, "0");

  ordered.forEach((photo, index) => {
    const target = columns[index % columnCount], figure = document.createElement("figure"), img = document.createElement("img"),
      caption = document.createElement("figcaption"), number = document.createElement("span"), remove = document.createElement("button"),
      random = seed(photo.src);
    figure.style.setProperty("--tilt", `${(random % 31 - 15) / 10}deg`);
    figure.style.setProperty("--width", `${88 + random % 15}%`);
    figure.style.setProperty("--gap", `${7 + random % 13}px`);
    figure.style.setProperty("--side", `${random % 2 ? "auto 0 0 auto" : "auto auto 0 0"}`);
    img.src = photo.src;
    img.alt = photo.name;
    img.loading = "eager";
    caption.textContent = photo.name.replace(/[（_]/g, " ").replace(/[）]/g, "");
    number.textContent = String(index + 1).padStart(2, "0");
    remove.type = "button";
    remove.className = "delete-photo";
    remove.textContent = "删除照片";
    remove.hidden = !online;
    remove.addEventListener("click", event => deletePhoto(event, photo));
    figure.append(img, caption, number, remove);
    target.set.appendChild(figure);
    target.images.push(img);
  });

  const loaded = columns.flatMap(({ images }) => images.map(img => new Promise(resolve => {
    if (img.complete) resolve();
    else {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", resolve, { once: true });
    }
  })));
  await Promise.all(loaded);

  columns.forEach(({ track, set }, index) => {
    const copy = set.cloneNode(true);
    copy.setAttribute("aria-hidden", "true");
    copy.querySelectorAll(".delete-photo").forEach(button => button.remove());
    track.appendChild(copy);
    const distance = set.getBoundingClientRect().height, seconds = Math.max(38, Math.round(distance / (24 + index * 2)));
    track.style.setProperty("--column-duration", `${seconds}s`);
    track.style.setProperty("--column-delay", `${-(seconds * (index + 1) / (columnCount + 1))}s`);
    track.classList.add("rolling");
  });
  updateCounter(ordered.length);
}

async function deletePhoto(event, photo) {
  event.preventDefault();
  event.stopPropagation();
  if (!confirm(`确定从照片墙删除“${photo.name}”吗？`)) return;
  const query = photo.uploaded ? `id=${encodeURIComponent(photo.id)}` : `path=${encodeURIComponent(photo.src)}`;
  try {
    const response = await api.request(`/api/photos?${query}`, { method: "DELETE" });
    const result = await api.readJson(response);
    if (!response.ok) return alert(result.error || "删除失败");
    location.reload();
  } catch {
    alert("无法连接照片服务，请检查网络后再试。");
  }
}

function updateCounter(count) {
  const started = performance.now();
  function tick(now) {
    const current = Math.floor(((now - started) / 2600) % Math.max(1, count)) + 1;
    document.getElementById("stream-current").textContent = String(current).padStart(2, "0");
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

const form = document.getElementById("upload-form"), fileInput = document.getElementById("photo-file"), addressInput = document.getElementById("photo-address"),
  fileLabel = document.getElementById("file-label"), status = document.getElementById("upload-status");
fileInput.addEventListener("change", () => { fileLabel.textContent = fileInput.files[0]?.name || "选择本地照片"; });

/* ---------- collapsible upload panel ---------- */
// Phones: starts collapsed and opens as a bottom sheet. Desktop: remembers the last choice in this browser.
const manager = document.getElementById("gallery-manager");
const managerOpen = document.getElementById("manager-open");
const managerClose = document.getElementById("manager-close");
const PANEL_KEY = "lulu-dengdeng-upload-panel";
const isPhone = () => matchMedia("(max-width:760px)").matches;

function setPanel(open, { remember = true, focus = false } = {}) {
  document.body.classList.toggle("manager-collapsed", !open);
  managerOpen.setAttribute("aria-expanded", String(open));
  managerClose.setAttribute("aria-expanded", String(open));
  if (remember && !isPhone()) {
    try { localStorage.setItem(PANEL_KEY, open ? "open" : "closed"); } catch {}
  }
  if (focus) (open ? managerClose : managerOpen).focus();
}

let savedPanel = null;
try { savedPanel = localStorage.getItem(PANEL_KEY); } catch {}
setPanel(!isPhone() && savedPanel !== "closed", { remember: false });

managerOpen.addEventListener("click", () => setPanel(true, { focus: true }));
managerClose.addEventListener("click", () => setPanel(false, { focus: true }));
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && isPhone() && !document.body.classList.contains("manager-collapsed")) setPanel(false, { focus: true });
});
// On phones, tapping the dimmed photos behind the sheet closes it.
document.addEventListener("click", event => {
  if (!isPhone() || document.body.classList.contains("manager-collapsed")) return;
  if (!manager.contains(event.target) && !managerOpen.contains(event.target)) setPanel(false);
});

function setUploadAvailability() {
  form.querySelector("button").disabled = !photoServiceOnline;
  status.textContent = photoServiceOnline ? "" : "照片服务暂时连不上，现在只能浏览照片。";
}

function uploadPhoto(file, address) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest(),
      url = api.url(`/api/photos?address=${encodeURIComponent(address)}&filename=${encodeURIComponent(file.name)}`);
    request.open("POST", url);
    request.withCredentials = true;
    request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    request.upload.addEventListener("progress", event => {
      if (event.lengthComputable) {
        const percent = Math.min(99, Math.round(event.loaded / event.total * 100));
        status.textContent = `正在上传照片… ${percent}%`;
      }
    });
    request.addEventListener("load", () => {
      let result;
      try { result = JSON.parse(request.responseText); } catch { reject(new Error(`服务器返回异常（${request.status || "无状态码"}）`)); return; }
      if (request.status === 401) { location.replace(`login.html?next=us.html`); return; }
      if (request.status < 200 || request.status >= 300) { reject(new Error(result.error || `上传失败（${request.status}）`)); return; }
      resolve(result);
    });
    request.addEventListener("error", () => reject(new Error("无法连接照片服务，请检查网络后再试。")));
    request.addEventListener("abort", () => reject(new Error("上传已取消。")));
    request.send(file);
  });
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const file = fileInput.files[0], address = addressInput.value.trim(), button = form.querySelector("button"),
    extension = file?.name.split(".").pop()?.toLowerCase();
  if (!file || !address) { status.textContent = "请选择照片并填写地址。"; return; }
  if (!["jpg", "jpeg", "png", "webp", "gif", "avif"].includes(extension)) { status.textContent = "暂不支持这种格式，请选择 JPG、PNG、WEBP、GIF 或 AVIF。"; return; }
  if (file.size > 25 * 1024 * 1024) { status.textContent = "照片不能超过 25MB。"; return; }
  button.disabled = true;
  status.textContent = "正在准备上传… 0%";
  try {
    const result = await uploadPhoto(file, address);
    if (result.needsLocation) {
      status.textContent = "照片已暂存，正在前往地图添加足迹…";
      location.href = `places.html?pending=${encodeURIComponent(result.pendingId)}&address=${encodeURIComponent(result.address)}`;
      return;
    }
    status.textContent = "照片已保存到现有地址，正在刷新照片墙…";
    setTimeout(() => location.reload(), 350);
  } catch (error) {
    status.textContent = error.message || "上传失败，请重试。";
    button.disabled = false;
  }
});

buildGallery();
