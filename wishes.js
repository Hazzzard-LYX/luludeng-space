// Wish lists. Page 1 (wishes.html): both people's counts. Page 2 (wishes.html?who=lulu): one person's list.
// Only the owner can make wishes or change their allowance; either person can tick a wish as done.
(function () {
  const app = document.getElementById("wishes-app");
  const api = window.LULU_API;
  const LATIN = { lulu: "LULU", dengdeng: "DENGDENG" };
  const MAX_WISH_LENGTH = 200;
  const MAX_REASON_LENGTH = 100;
  let state = null;
  let statusText = "";
  let openAllowanceForm = null; // "up" | "down" | null

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const pad = number => String(number).padStart(2, "0");
    return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
  }

  function nameOf(key) {
    const person = state && state.people.find(item => item.key === key);
    return person ? person.name : "";
  }

  function currentWho() {
    return new URLSearchParams(location.search).get("who");
  }

  function go(who) {
    history.pushState(null, "", who ? `?who=${encodeURIComponent(who)}` : location.pathname);
    statusText = "";
    openAllowanceForm = null;
    render();
    window.scrollTo(0, 0);
  }

  async function load() {
    const response = await api.request("/api/wishes", { cache: "no-store" });
    const data = await api.readJson(response);
    if (!response.ok) throw new Error(data.error || "愿望单暂时打不开");
    state = data;
  }

  async function act(path, init, successText) {
    try {
      const response = await api.request(path, init);
      const data = await api.readJson(response);
      if (!response.ok) throw new Error(data.error || "没有保存成功，请稍后再试");
      statusText = successText || "";
      await load();
      return true;
    } catch (error) {
      statusText = error.message || "没有保存成功，请稍后再试";
      return false;
    } finally {
      render();
    }
  }

  function postJson(path, body, successText) {
    return act(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, successText);
  }

  function stats(person) {
    const list = el("dl", "wish-stats");
    [["已实现", person.done], ["待实现", person.pending], ["剩余许愿", person.remaining]].forEach(([label, value]) => {
      const item = el("div");
      item.append(el("dt", "", label), el("dd", "", String(value)));
      list.append(item);
    });
    return list;
  }

  /* ---------- page 1: overview ---------- */

  function renderOverview() {
    document.title = "愿望单｜LuLu & DengDeng";
    const intro = el("section", "wish-intro");
    intro.append(el("span", "kicker", "03 / WISHES"), el("h1", "", "我们的愿望单"), el("p", "", "许下的愿望，一个一个去实现。"));

    const people = el("div", "wish-people");
    state.people.forEach(person => {
      const card = el("button", "wish-person");
      card.type = "button";
      card.addEventListener("click", () => go(person.key));

      const head = el("div", "wish-person-head");
      head.append(el("small", "", `${LATIN[person.key] || ""}'S WISHES`));
      const title = el("h2", "", `${person.name}的愿望`);
      if (state.me === person.key) title.append(el("em", "", "我"));
      head.append(title);

      const peek = el("ul", "wish-peek");
      const pending = person.wishes.filter(wish => !wish.done).slice(-3).reverse();
      if (pending.length) pending.forEach(wish => peek.append(el("li", "", wish.text)));
      else peek.append(el("li", "empty", person.wishes.length ? "愿望都实现啦" : "还没有许过愿望"));

      card.append(head, stats(person), peek, el("b", "wish-arrow", "→"));
      people.append(card);
    });

    app.replaceChildren(intro, people);
  }

  /* ---------- page 2: one person's list ---------- */

  function wishItem(person, wish, isOwner) {
    const item = el("li", wish.done ? "wish-item done" : "wish-item");
    const label = el("label", "wish-check");
    const box = el("input");
    box.type = "checkbox";
    box.checked = wish.done;
    box.disabled = !state.me;
    box.setAttribute("aria-label", `${wish.done ? "取消实现" : "标记为已实现"}：${wish.text}`);
    box.addEventListener("change", () => {
      postJson("/api/wishes/check", { id: wish.id, done: box.checked }, box.checked ? "又实现了一个愿望 ✓" : "");
    });
    label.append(box, el("span", "wish-box", ""), el("span", "wish-text", wish.text));

    const meta = el("small", "wish-meta", `许于 ${formatDate(wish.created_at)}`);
    if (wish.done) meta.textContent += ` · 实现于 ${formatDate(wish.done_at)}${wish.done_by ? `（${nameOf(wish.done_by)}打的勾）` : ""}`;
    item.append(label, meta);

    if (isOwner && !wish.done) {
      const remove = el("button", "wish-delete", "×");
      remove.type = "button";
      remove.setAttribute("aria-label", `删除愿望：${wish.text}`);
      remove.addEventListener("click", () => {
        if (!confirm(`删掉“${wish.text}”吗？\n删掉后会退回 1 个许愿名额。`)) return;
        act(`/api/wishes?id=${encodeURIComponent(wish.id)}`, { method: "DELETE" }, "已删除，名额退回 1 个");
      });
      item.append(remove);
    }
    return item;
  }

  function addForm(person) {
    const form = el("form", "wish-add");
    const input = el("input");
    input.type = "text";
    input.maxLength = MAX_WISH_LENGTH;
    input.placeholder = person.remaining > 0 ? "许一个愿望……" : "许愿名额用完了，先增加名额吧";
    input.required = true;
    input.disabled = person.remaining < 1;
    input.setAttribute("aria-label", "新的愿望");
    const button = el("button", "", `许愿 · 剩 ${person.remaining}`);
    button.type = "submit";
    button.disabled = person.remaining < 1;
    form.append(input, button);
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      button.disabled = true;
      const saved = await postJson("/api/wishes", { text }, "许下了一个新愿望");
      const next = app.querySelector(".wish-add input");
      if (saved && next && !next.disabled) next.focus();
    });
    return form;
  }

  function allowancePanel(person, isOwner) {
    const panel = el("aside", "wish-allowance");
    panel.append(el("small", "", "WISH ALLOWANCE"), el("div", "allowance-number", String(person.remaining)), el("p", "", "剩余许愿名额"));

    if (isOwner) {
      const buttons = el("div", "allowance-buttons");
      const up = el("button", openAllowanceForm === "up" ? "active" : "", "＋ 增加名额");
      const down = el("button", openAllowanceForm === "down" ? "active" : "", "− 减少名额");
      up.type = down.type = "button";
      down.disabled = person.remaining < 1;
      const toggleForm = kind => {
        openAllowanceForm = openAllowanceForm === kind ? null : kind;
        statusText = "";
        render();
        // Focus only when the form is opened, not on every redraw.
        if (openAllowanceForm) app.querySelector(kind === "up" ? ".allowance-form input[type=text]" : ".allowance-form input[type=number]")?.focus();
      };
      up.addEventListener("click", () => toggleForm("up"));
      down.addEventListener("click", () => toggleForm("down"));
      buttons.append(up, down);
      panel.append(buttons);

      if (openAllowanceForm) {
        const raising = openAllowanceForm === "up";
        const form = el("form", "allowance-form");
        const amountLabel = el("label", "", raising ? "增加几个" : "减少几个");
        const amount = el("input");
        amount.type = "number";
        amount.min = "1";
        amount.max = String(raising ? 20 : Math.min(20, person.remaining));
        amount.value = "1";
        amount.required = true;
        amountLabel.append(amount);
        const reasonLabel = el("label", "", raising ? "理由（必填）" : "理由（选填）");
        const reason = el("input");
        reason.type = "text";
        reason.maxLength = MAX_REASON_LENGTH;
        reason.required = raising;
        reason.placeholder = raising ? "比如：今天一起做了一件很棒的事" : "";
        reasonLabel.append(reason);
        const submit = el("button", "", raising ? "确认增加" : "确认减少");
        submit.type = "submit";
        form.append(amountLabel, reasonLabel, submit);
        form.addEventListener("submit", async event => {
          event.preventDefault();
          const count = Number(amount.value);
          if (!Number.isInteger(count) || count < 1) return;
          if (raising && !reason.value.trim()) { reason.focus(); return; }
          submit.disabled = true;
          const saved = await postJson("/api/wishes/allowance", { delta: raising ? count : -count, reason: reason.value.trim() }, raising ? `增加了 ${count} 个许愿名额` : `减少了 ${count} 个许愿名额`);
          if (saved) { openAllowanceForm = null; render(); }
        });
        panel.append(form);
      }
    }

    const history = el("section", "allowance-history");
    history.append(el("h3", "", "名额记录"));
    const list = el("ul");
    if (!person.allowance.length) list.append(el("li", "empty", "还没有名额记录"));
    person.allowance.forEach(change => {
      const row = el("li", change.delta > 0 ? "up" : "down");
      row.append(
        el("b", "", `${change.delta > 0 ? "+" : "−"}${Math.abs(change.delta)}`),
        el("span", "", change.reason || (change.delta > 0 ? "" : "减少名额")),
        el("time", "", formatDate(change.created_at))
      );
      list.append(row);
    });
    history.append(list);
    panel.append(history);
    return panel;
  }

  function renderList(person) {
    document.title = `${person.name}的许愿清单｜LuLu & DengDeng`;
    const isOwner = state.me === person.key;

    const head = el("section", "wish-list-head");
    const back = el("button", "wish-back", "← 愿望单");
    back.type = "button";
    back.addEventListener("click", () => go(null));
    head.append(back, el("span", "kicker", `${LATIN[person.key] || ""}'S WISHLIST`), el("h1", "", `${person.name}的许愿清单`), stats(person));

    const listPanel = el("section", "wish-list-panel");
    if (isOwner) listPanel.append(addForm(person));
    else if (state.me) listPanel.append(el("p", "wish-note", `这是${person.name}的清单，只有${person.name}能许愿；实现了的话，你可以帮忙打勾。`));
    else listPanel.append(el("p", "wish-note", "没有认出你是噜噜还是噔噔，现在只能查看。"));
    if (statusText) {
      const status = el("p", "wish-status", statusText);
      status.setAttribute("role", "status");
      listPanel.append(status);
    }

    const pending = person.wishes.filter(wish => !wish.done);
    const done = person.wishes.filter(wish => wish.done).sort((a, b) => String(b.done_at).localeCompare(String(a.done_at)));
    const pendingList = el("ol", "wish-items");
    if (!pending.length) pendingList.append(el("li", "wish-empty", person.wishes.length ? "所有愿望都实现啦。" : "还没有许过愿望。"));
    pending.forEach(wish => pendingList.append(wishItem(person, wish, isOwner)));
    listPanel.append(el("h2", "wish-section-title", `待实现 · ${pending.length}`), pendingList);

    if (done.length) {
      const doneList = el("ol", "wish-items");
      done.forEach(wish => doneList.append(wishItem(person, wish, isOwner)));
      listPanel.append(el("h2", "wish-section-title", `已实现 · ${done.length}`), doneList);
    }

    const columns = el("div", "wish-columns");
    columns.append(listPanel, allowancePanel(person, isOwner));
    app.replaceChildren(head, columns);
  }

  function render() {
    if (!state) return;
    const person = state.people.find(item => item.key === currentWho());
    if (person) renderList(person);
    else renderOverview();
  }

  window.addEventListener("popstate", () => { statusText = ""; openAllowanceForm = null; render(); });

  load().then(render).catch(error => {
    app.replaceChildren(el("p", "wish-loading", error.message || "愿望单暂时打不开，请稍后再试。"));
  });
})();
