// 需求反馈 (feedback board): plain floating panel for website feature requests / bug reports.
// Wrapped in a function so its names (setOpen, element, formatTime...) stay private: index.html loads it
// after message-board.js, which has functions with the same names in the shared global scope.
(function () {
  const feedbackTab = document.getElementById("feedback-tab");
  const feedbackPanel = document.getElementById("feedback-panel");
  const feedbackClose = document.getElementById("feedback-close");
  const feedbackForm = document.getElementById("feedback-form");
  const feedbackType = document.getElementById("feedback-type");
  const feedbackContent = document.getElementById("feedback-content");
  const feedbackStatus = document.getElementById("feedback-status");
  const feedbackList = document.getElementById("feedback-list");
  const feedbackLogList = document.getElementById("feedback-log-list");
  const feedbackLogDetails = document.getElementById("feedback-log-details");
  const feedbackApiUrl = window.LULU_API.url("/api/feedback");
  const feedbackCheckApiUrl = window.LULU_API.url("/api/feedback/check");
  const MAX_FEEDBACK_LENGTH = 500;
  const MAX_REASON_LENGTH = 100;
  const MAX_DONE_NOTE_LENGTH = 200;

  const PERSON_NAMES = { lulu: "噜噜", dengdeng: "噔噔" };
  const TYPE_LABELS = { bug: "Bug", feature: "功能建议", other: "其他" };

  function personName(key) {
    return PERSON_NAMES[key] || "";
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  /* ---------- open / close ---------- */

  function setOpen(open) {
    feedbackPanel.classList.toggle("open", open);
    feedbackPanel.setAttribute("aria-hidden", String(!open));
    feedbackTab.setAttribute("aria-expanded", String(open));
  }

  feedbackTab.addEventListener("click", () => setOpen(!feedbackPanel.classList.contains("open")));
  feedbackClose.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && feedbackPanel.classList.contains("open")) setOpen(false);
  });

  /* ---------- rendering ---------- */

  function feedbackRow(item) {
    const row = element("li", "feedback-item");
    row.dataset.type = item.type;
    if (item.done) row.classList.add("done");

    row.append(element("span", "feedback-type-tag", TYPE_LABELS[item.type] || item.type));
    row.append(element("p", "feedback-text", item.content));

    const metaParts = [personName(item.created_by) || "匿名", formatTime(item.created_at)];
    if (item.done) metaParts.push(`${personName(item.done_by) || ""} 完成于 ${formatTime(item.done_at)}`);
    row.append(element("div", "feedback-meta", metaParts.filter(Boolean).join(" · ")));
    if (item.done && item.done_note) {
      const note = element("p", "feedback-done-note");
      note.append(element("b", "", "完成总结"), document.createTextNode(item.done_note));
      row.append(note);
    }

    const actions = element("div", "feedback-actions");
    const doneButton = element("button", "feedback-done-btn", item.done ? "已完成，点击恢复" : "标记完成");
    doneButton.type = "button";
    const deleteButton = element("button", "feedback-delete-btn", "删除");
    deleteButton.type = "button";
    actions.append(doneButton, deleteButton);
    row.append(actions);

    // Marking done asks what was actually done; deleting asks why. Only one of the two forms is open at a time.
    const doneForm = inlineForm("feedback-done-form", "做了什么（必填）", MAX_DONE_NOTE_LENGTH, "确认完成", note => toggleDone(item.id, true, note));
    const deleteForm = inlineForm("feedback-delete-form", "删除理由（必填）", MAX_REASON_LENGTH, "确认删除", reason => deleteFeedback(item.id, reason));
    row.append(doneForm.form, deleteForm.form);

    doneButton.addEventListener("click", () => {
      if (item.done) {
        toggleDone(item.id, false);
        return;
      }
      deleteForm.close();
      doneForm.open();
    });
    deleteButton.addEventListener("click", () => {
      doneForm.close();
      deleteForm.open();
    });

    return row;
  }

  function inlineForm(className, placeholder, maxLength, submitLabel, onSubmit) {
    const form = element("form", `feedback-inline-form ${className} hidden`);
    const input = element("input");
    input.type = "text";
    input.placeholder = placeholder;
    input.maxLength = maxLength;
    input.required = true;
    const confirmButton = element("button", "", submitLabel);
    confirmButton.type = "submit";
    const cancelButton = element("button", "", "取消");
    cancelButton.type = "button";
    form.append(input, confirmButton, cancelButton);

    const open = () => {
      form.classList.remove("hidden");
      input.focus();
    };
    const close = () => {
      form.classList.add("hidden");
      input.value = "";
    };
    cancelButton.addEventListener("click", close);
    form.addEventListener("submit", event => {
      event.preventDefault();
      const value = input.value.trim();
      if (!value) {
        input.focus();
        return;
      }
      onSubmit(value);
    });
    return { form, open, close };
  }

  function logRow(entry) {
    const li = element("li");
    const who = personName(entry.deleted_by) || "";
    const text = `${who ? `${who} ` : ""}删除于 ${formatTime(entry.deleted_at)} · 「${entry.content}」`;
    li.append(element("b", "", TYPE_LABELS[entry.type] || entry.type), document.createTextNode(` ${text} · 理由：${entry.deleted_reason || ""}`));
    return li;
  }

  function render(items, deletedLog) {
    feedbackList.innerHTML = "";
    const pending = items.filter(item => !item.done);
    const done = items.filter(item => item.done);

    if (!items.length) {
      feedbackList.append(element("li", "feedback-empty", "还没有反馈，想到什么都可以写下来。"));
    } else {
      if (pending.length) {
        feedbackList.append(element("li", "feedback-section-title", `待处理 · ${pending.length}`));
        pending.forEach(item => feedbackList.append(feedbackRow(item)));
      }
      if (done.length) {
        feedbackList.append(element("li", "feedback-section-title", `已完成 · ${done.length}`));
        done.forEach(item => feedbackList.append(feedbackRow(item)));
      }
    }

    feedbackLogList.innerHTML = "";
    if (!deletedLog.length) {
      feedbackLogList.append(element("li", "", "还没有删除记录"));
    } else {
      deletedLog.forEach(entry => feedbackLogList.append(logRow(entry)));
    }
    feedbackLogDetails.querySelector("summary").textContent = `已删除记录 · ${deletedLog.length}`;
  }

  /* ---------- data ---------- */

  async function loadFeedback() {
    try {
      const response = await window.LULU_API.request(feedbackApiUrl, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const result = await response.json();
      render(Array.isArray(result.items) ? result.items : [], Array.isArray(result.deletedLog) ? result.deletedLog : []);
    } catch {
      feedbackList.innerHTML = "";
      feedbackList.append(element("li", "feedback-empty", "暂时无法加载，请检查网络后再试。"));
    }
  }

  async function toggleDone(id, done, note) {
    try {
      const response = await window.LULU_API.request(feedbackCheckApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(done ? { id, done, note } : { id, done })
      });
      const result = await window.LULU_API.readJson(response);
      if (!response.ok) throw new Error(result.error || "操作失败");
      await loadFeedback();
    } catch (error) {
      feedbackStatus.textContent = error.message || "操作失败，请稍后再试。";
    }
  }

  async function deleteFeedback(id, reason) {
    try {
      const response = await window.LULU_API.request(`${feedbackApiUrl}?id=${encodeURIComponent(id)}&reason=${encodeURIComponent(reason)}`, { method: "DELETE" });
      const result = await window.LULU_API.readJson(response);
      if (!response.ok) throw new Error(result.error || "删除失败");
      await loadFeedback();
    } catch (error) {
      feedbackStatus.textContent = error.message || "删除失败，请稍后再试。";
    }
  }

  feedbackForm.addEventListener("submit", async event => {
    event.preventDefault();
    const content = feedbackContent.value.trim().slice(0, MAX_FEEDBACK_LENGTH);
    const type = feedbackType.value;
    const button = feedbackForm.querySelector('button[type="submit"]');
    if (!content) {
      feedbackStatus.textContent = "先写下想反馈的内容吧。";
      feedbackContent.focus();
      return;
    }

    button.disabled = true;
    feedbackStatus.textContent = "正在提交……";
    try {
      const response = await window.LULU_API.request(feedbackApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, content })
      });
      const result = await window.LULU_API.readJson(response);
      if (!response.ok) throw new Error(result.error || "提交失败");
      feedbackContent.value = "";
      feedbackStatus.textContent = "提交好了。";
      await loadFeedback();
    } catch (error) {
      feedbackStatus.textContent = error.message || "暂时无法提交，请检查网络后再试。";
    } finally {
      button.disabled = false;
    }
  });

  loadFeedback();
})();
