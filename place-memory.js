// 城市回忆 (place.html?name=上海): the photos taken in one place, framed on a wall.
// Each photo can be deleted here; it disappears from the photo wall too (same /api/photos as us.html).
const params = new URLSearchParams(location.search),
  placeName = (params.get("name") || "我们的地点").trim(),
  nameElement = document.getElementById("place-name"),
  description = document.getElementById("place-description"),
  counter = document.getElementById("place-photo-count"),
  gallery = document.getElementById("place-gallery");
const aliasGroups = [["上海", "shanghai"], ["香港", "hongkong", "hong kong"], ["深圳", "shenzhen"]];

function normalize(value) { return String(value || "").toLowerCase().replace(/[\s\-_.,，。/\\]+/g, ""); }
function folderOf(photo) { return photo.place || ""; }
async function loadAll() { return window.LULU_API.loadPhotos(); }
function matchingFolders(name) {
  const wanted = normalize(name), group = aliasGroups.find(items => items.some(item => normalize(item) === wanted));
  return group || [name];
}
function matchesPlace(photo) {
  const folder = normalize(folderOf(photo));
  return matchingFolders(placeName).some(target => folder === normalize(target));
}

function showEmpty() {
  description.textContent = "这里还没有照片。等我们抵达，或从 Us 页面上传同名地址的照片。";
  gallery.classList.add("empty");
  gallery.innerHTML = "<div><b>MEMORIES ARE WAITING</b><p>属于这里的故事，还在路上。</p><a href=\"us.html\">去添加照片 →</a></div>";
}

function renumber() {
  const frames = [...gallery.querySelectorAll("figure")];
  frames.forEach((figure, index) => { figure.querySelector(".photo-number").textContent = String(index + 1).padStart(2, "0"); });
  counter.textContent = String(frames.length).padStart(2, "0");
  if (!frames.length) showEmpty();
}

async function deletePhoto(photo, figure, button) {
  if (!confirm(`确定删除“${photo.name}”吗？\n照片墙里也会一起删掉。`)) return;
  // Uploaded photos are deleted by id; photos committed to the site (assets/) can only be hidden.
  const query = photo.uploaded ? `id=${encodeURIComponent(photo.id)}` : `path=${encodeURIComponent(photo.src)}`;
  button.disabled = true;
  button.textContent = "删除中…";
  try {
    const response = await window.LULU_API.request(`/api/photos?${query}`, { method: "DELETE" });
    const result = await window.LULU_API.readJson(response);
    if (!response.ok) throw new Error(result.error || "删除失败，请稍后再试");
    figure.classList.add("removing");
    setTimeout(() => { figure.remove(); renumber(); }, 250);
  } catch (error) {
    alert(error.message === "Failed to fetch" ? "无法连接照片服务，请检查网络后再试。" : error.message);
    button.disabled = false;
    button.textContent = "删除";
  }
}

function createPhoto(photo, index, canDelete) {
  const figure = document.createElement("figure"), img = document.createElement("img"),
    caption = document.createElement("figcaption"), number = document.createElement("span");
  figure.style.setProperty("--frame-tilt", `${((index * 17) % 9 - 4) * .32}deg`);
  figure.style.setProperty("--frame-lift", `${index % 4 === 1 ? 28 : index % 4 === 3 ? 12 : 0}px`);
  img.src = photo.src;
  img.alt = photo.name;
  img.loading = index < 6 ? "eager" : "lazy";
  img.addEventListener("load", () => figure.classList.add(img.naturalWidth > img.naturalHeight * 1.12 ? "landscape" : "portrait"), { once: true });
  caption.textContent = photo.name;
  number.className = "photo-number";
  number.textContent = String(index + 1).padStart(2, "0");
  figure.append(img, caption, number);
  if (canDelete) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "place-photo-delete";
    remove.textContent = "删除";
    remove.setAttribute("aria-label", `删除照片：${photo.name}`);
    remove.addEventListener("click", () => deletePhoto(photo, figure, remove));
    figure.append(remove);
  }
  return figure;
}

async function render() {
  nameElement.textContent = placeName;
  document.title = `${placeName}｜LuLu & DengDeng`;
  const { online, photos: all } = await loadAll();
  const photos = all.filter(matchesPlace);
  counter.textContent = String(photos.length).padStart(2, "0");
  if (!photos.length) { showEmpty(); return; }
  description.textContent = "每一张照片，都是我们一起抵达这里的证明。";
  // Deleting needs the photo service; when it can't be reached, only show the photos.
  photos.forEach((photo, index) => gallery.appendChild(createPhoto(photo, index, online)));
}

render();
