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

      // Newest wish that is still waiting to come true, from either person.
      const latest = document.getElementById("home-wish-latest");
      const newest = data.people
        .flatMap(person => person.wishes.filter(wish => !wish.done).map(wish => ({ ...wish, name: person.name })))
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
      if (latest && newest) {
        const text = newest.text.length > 16 ? `${newest.text.slice(0, 16)}…` : newest.text;
        latest.textContent = `最新愿望 · ${newest.name}：${text}`;
      }
    })
    .catch(() => {
      rows.querySelectorAll("em").forEach(em => { em.textContent = ""; });
    });
})();
