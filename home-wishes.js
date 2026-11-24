// Fills the home page's wish list note with each person's 已实现 / 待实现 counts.
(function () {
  const rows = document.getElementById("home-wish-rows");
  if (!rows || !window.LULU_API) return;

  function row(person) {
    const item = document.createElement("li");
    if (person.done > 0) item.className = "has-done";
    const box = document.createElement("i");
    box.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.textContent = person.name;
    const counts = document.createElement("em");
    const done = document.createElement("b");
    done.textContent = String(person.done);
    const pending = document.createElement("b");
    pending.textContent = String(person.pending);
    counts.append("已实现 ", done, " · 待实现 ", pending);
    item.append(box, name, counts);
    return item;
  }

  window.LULU_API.request("/api/wishes", { cache: "no-store" })
    .then(response => (response.ok ? response.json() : null))
    .then(data => {
      if (!data || !Array.isArray(data.people)) return;
      rows.replaceChildren(...data.people.map(row));
    })
    .catch(() => {
      rows.querySelectorAll("em").forEach(em => { em.textContent = ""; });
    });
})();
