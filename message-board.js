// Message board notebook. Views (notebook[data-view]):
//   home    – choose 写留言 or 查看留言 (shown first when the board opens)
//   toc     – contents: number, date and topic of every message; click to jump
//   reading – one page at a time, with page turning
//   compose – writing a new message (optional topic + text)
const boardTab = document.getElementById("message-board-tab");
const board = document.getElementById("message-board");
const notebook = board.querySelector(".notebook");
const closeButton = document.getElementById("message-board-close");
const messageForm = document.getElementById("message-form");
const messageText = document.getElementById("message-text");
const messageCount = document.getElementById("message-count");
const messageStatus = document.getElementById("message-status");
const messageList = document.getElementById("message-list");
const messagesApiUrl = window.LULU_API.url("/api/messages");
const messageAuthor = String(window.LULU_MESSAGE_AUTHOR || "噜噜 & 噔噔").trim();
const messageMood = String(window.LULU_MESSAGE_MOOD || "love").trim();
const MAX_TITLE_LENGTH = 30;
const MAX_CONTENT_LENGTH = 5000;

let messages = [];
let readingPages = [];
let currentPage = 0;
let composeTextareas = [messageText];
let currentComposePage = 0;
let isTurning = false;
let view = "home";
let composeReturnView = "home";

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function normalizeMessage(message) {
  return {
    ...message,
    title: typeof message.title === "string" ? message.title.trim() : "",
    text: typeof message.content === "string" ? message.content : String(message.text || ""),
    createdAt: message.created_at || message.createdAt || ""
  };
}

/* ---------- home view ---------- */

const homeView = element("section", "board-home");
homeView.setAttribute("aria-label", "留言板目录入口");
const writeOption = element("button", "home-option write");
writeOption.type = "button";
writeOption.append(element("small", "", "WRITE"), element("b", "", "写留言"), element("span", "", "翻到新的一页，写给你"), element("i", "", "→"));
const readOption = element("button", "home-option read");
readOption.type = "button";
const readSummary = element("span", "", "正在翻开笔记本……");
readOption.append(element("small", "", "READ"), element("b", "", "查看留言"), readSummary, element("i", "", "→"));
homeView.append(writeOption, readOption);
notebook.append(homeView);

/* ---------- contents view ---------- */

const tocView = element("section", "board-toc");
tocView.setAttribute("aria-label", "留言目录");
const tocHead = element("div", "board-subhead");
const tocBack = element("button", "", "← 返回");
tocBack.type = "button";
tocHead.append(tocBack, element("span", "", "CONTENTS · 目录"));
const tocColumns = element("div", "toc-columns");
tocColumns.append(element("span", "", "NO."), element("span", "", "日期"), element("span", "", "主题"));
const tocList = element("ol", "toc-list");
tocView.append(tocHead, tocColumns, tocList);
notebook.append(tocView);

/* ---------- compose form additions ---------- */

const composeHeading = element("div", "compose-heading");
const composeBackButton = element("button", "", "← 返回");
composeBackButton.type = "button";
composeBackButton.setAttribute("aria-label", "返回上一页");
composeHeading.append(composeBackButton, element("span", "", "NEW PAGE · 写给你"));
messageForm.prepend(composeHeading);

const titleLabel = element("label", "compose-title");
titleLabel.htmlFor = "message-title";
titleLabel.append(element("span", "", "主题"));
const titleInput = element("input");
titleInput.id = "message-title";
titleInput.type = "text";
titleInput.maxLength = MAX_TITLE_LENGTH;
titleInput.placeholder = "可以不写";
titleInput.autocomplete = "off";
titleLabel.append(titleInput);
composeHeading.after(titleLabel);

const composePages = element("div", "compose-pages");
messageText.before(composePages);
messageText.maxLength = MAX_CONTENT_LENGTH;
messageText.classList.add("compose-text-page", "active");
composePages.append(messageText);

const composeMeasure = element("textarea", "compose-text-page compose-measure");
composeMeasure.tabIndex = -1;
composeMeasure.setAttribute("aria-hidden", "true");
composePages.append(composeMeasure);

const composePagination = element("nav", "compose-pagination");
composePagination.setAttribute("aria-label", "书写页翻页");
const composePreviousButton = element("button", "compose-prev", "← 上一页");
const composePageNumber = element("span", "compose-page-number", "新页 1 / 1");
const composeNextButton = element("button", "compose-next", "下一页 →");
composePreviousButton.type = composeNextButton.type = "button";
composePreviousButton.setAttribute("aria-label", "上一张书写页");
composeNextButton.setAttribute("aria-label", "下一张书写页");
composePageNumber.setAttribute("aria-live", "polite");
composePagination.append(composePreviousButton, composePageNumber, composeNextButton);
composePages.after(composePagination);

/* ---------- reading view ---------- */

const messagePage = element("div", "message-page");
messageList.before(messagePage);

const readingHead = element("div", "board-subhead reading-head");
const readingBack = element("button", "", "← 目录");
readingBack.type = "button";
const readingTitle = element("span", "reading-title", "");
const readingWrite = element("button", "", "写留言 →");
readingWrite.type = "button";
readingHead.append(readingBack, readingTitle, readingWrite);
messagePage.append(readingHead, messageList);

const pagination = element("nav", "message-pagination");
pagination.setAttribute("aria-label", "留言翻页");
const previousButton = element("button", "", "← 上一页");
const pageNumber = element("span", "", "第 1 / 1 页");
const nextButton = element("button", "", "下一页 →");
previousButton.type = nextButton.type = "button";
previousButton.setAttribute("aria-label", "翻到上一页");
nextButton.setAttribute("aria-label", "翻到下一页");
pageNumber.setAttribute("aria-live", "polite");
pagination.append(previousButton, pageNumber, nextButton);
messagePage.append(pagination);

const readingMeasure = element("p", "reading-page-measure");
readingMeasure.setAttribute("aria-hidden", "true");
notebook.append(readingMeasure);

/* ---------- helpers ---------- */

function orderedMessages() {
  return messages.slice().sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = number => String(number).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
}

function splitByMeasuredHeight(text, measure, maxHeight) {
  if (!text) return [""];
  if (!maxHeight || maxHeight < 40) {
    const fallbackSize = 150;
    return Array.from({ length: Math.ceil(text.length / fallbackSize) }, (_, index) => text.slice(index * fallbackSize, (index + 1) * fallbackSize));
  }

  const pages = [];
  let start = 0;
  while (start < text.length) {
    let low = start + 1;
    let high = text.length;
    let best = start + 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = text.slice(start, middle);
      if (measure instanceof HTMLTextAreaElement) measure.value = candidate;
      else measure.textContent = candidate;
      if (measure.scrollHeight <= maxHeight + 1) {
        best = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    pages.push(text.slice(start, best));
    start = best;
  }
  return pages;
}

/* ---------- views ---------- */

function setView(next) {
  view = next;
  notebook.dataset.view = next;
  notebook.classList.toggle("composing", next === "compose");
}

function renderHome() {
  const ordered = orderedMessages();
  renderHomeNote(ordered);
  if (!ordered.length) {
    readSummary.textContent = "还没有写过留言";
    return;
  }
  readSummary.textContent = `共 ${ordered.length} 篇 · 最近一篇 ${formatDate(ordered[ordered.length - 1].createdAt)}`;
}

// The 留言板 note on the home page (the board's open button) shows a short summary.
function renderHomeNote(ordered) {
  const count = document.getElementById("home-board-count");
  const date = document.getElementById("home-board-date");
  const latest = document.getElementById("home-board-latest");
  if (!count || !date || !latest) return;
  if (!ordered.length) {
    count.textContent = "还没有写过留言";
    date.textContent = "";
    latest.textContent = "下一页，留给我们";
    return;
  }
  const last = ordered[ordered.length - 1];
  count.textContent = `共 ${ordered.length} 篇`;
  date.textContent = `最近 ${formatDate(last.createdAt)}`;
  latest.textContent = last.title ? `最新一篇 ·《${last.title}》` : `最新一篇 · ${last.text.replace(/\s+/g, " ").slice(0, 18)}${last.text.length > 18 ? "…" : ""}`;
}

function renderToc() {
  tocList.innerHTML = "";
  const ordered = orderedMessages();
  if (!ordered.length) {
    tocList.append(element("li", "toc-empty", "还没有写过留言，下一页留给我们。"));
    return;
  }
  ordered.forEach((message, index) => {
    const item = element("li");
    const entry = element("button", "toc-entry");
    entry.type = "button";
    const time = element("time", "", formatDate(message.createdAt));
    time.dateTime = message.createdAt;
    entry.append(element("span", "toc-no", String(index + 1).padStart(2, "0")), time, element("span", "toc-title", message.title));
    entry.setAttribute("aria-label", `第 ${index + 1} 篇，${formatDate(message.createdAt)}${message.title ? `，${message.title}` : ""}`);
    entry.addEventListener("click", () => openMessage(message.id));
    item.append(entry);
    tocList.append(item);
  });
}

function showHome() {
  renderHome();
  setView("home");
}

function showToc() {
  renderToc();
  setView("toc");
  tocList.scrollTop = 0;
}

// Reading pages are measured against the visible page, so (re)build them once the reading view is shown.
function showReading({ messageId = null, latest = false, animate = null } = {}) {
  setView("reading");
  requestAnimationFrame(() => {
    rebuildReadingPages(latest);
    if (messageId) {
      const index = readingPages.findIndex(page => page.message.id === messageId && page.fragmentIndex === 0);
      if (index >= 0) currentPage = index;
      renderMessages();
    }
    if (animate) {
      messagePage.classList.add(animate);
      setTimeout(() => messagePage.classList.remove(animate), 240);
    }
  });
}

function openMessage(id) {
  showReading({ messageId: id, animate: "turn-in-next" });
}

function rebuildReadingPages(showLatest = false) {
  const oldLength = readingPages.length;
  const oldPage = currentPage;
  readingPages = [];

  const textWidth = Math.max(180, messageList.clientWidth - 18);
  const textHeight = Math.max(120, messageList.clientHeight - 88);
  readingMeasure.style.width = `${textWidth}px`;

  orderedMessages().forEach((message, messageIndex) => {
    const fragments = splitByMeasuredHeight(message.text, readingMeasure, textHeight);
    fragments.forEach((fragment, fragmentIndex) => {
      readingPages.push({ message, messageIndex, text: fragment, fragmentIndex, fragmentCount: fragments.length });
    });
  });

  if (showLatest) {
    // Open at the first page of the newest message, not in the middle of it.
    const last = readingPages[readingPages.length - 1];
    currentPage = last ? readingPages.findIndex(page => page.message === last.message) : 0;
  } else if (oldLength) {
    currentPage = Math.min(oldPage, Math.max(0, readingPages.length - 1));
  }
  renderMessages();
}

function renderMessages() {
  const totalPages = Math.max(1, readingPages.length);
  currentPage = Math.max(0, Math.min(currentPage, totalPages - 1));
  messageList.innerHTML = "";

  if (!readingPages.length) {
    messageList.innerHTML = '<div class="message-empty"><b>还没有写过留言。</b><br>下一页，留给我们。</div>';
    readingTitle.textContent = "";
  } else {
    const page = readingPages[currentPage];
    const number = `第 ${page.messageIndex + 1} 篇`;
    readingTitle.textContent = page.message.title ? `${number} · ${page.message.title}` : number;

    const note = element("article", "featured-message");
    const text = element("p", "", page.text);
    const footer = element("footer");
    const time = element("time", "", `${formatTime(page.message.createdAt)}${page.fragmentCount > 1 ? ` · ${page.fragmentIndex + 1}/${page.fragmentCount}` : ""}`);
    const deleteButton = element("button", "", "×");
    deleteButton.type = "button";
    deleteButton.setAttribute("aria-label", "删除这条留言");
    deleteButton.addEventListener("click", () => deleteMessage(page.message.id));
    footer.append(time, deleteButton);
    note.append(text, footer);
    messageList.append(note);
  }

  pageNumber.textContent = `第 ${currentPage + 1} / ${totalPages} 页`;
  previousButton.disabled = currentPage === 0;
  nextButton.disabled = currentPage === totalPages - 1;
}

function turnPage(direction) {
  const targetPage = currentPage + direction;
  if (isTurning || targetPage < 0 || targetPage >= Math.max(1, readingPages.length)) return;

  isTurning = true;
  const outClass = direction > 0 ? "turn-out-next" : "turn-out-prev";
  const inClass = direction > 0 ? "turn-in-next" : "turn-in-prev";
  messagePage.classList.add(outClass);

  setTimeout(() => {
    currentPage = targetPage;
    renderMessages();
    messagePage.classList.remove(outClass);
    void messagePage.offsetWidth;
    messagePage.classList.add(inClass);
    setTimeout(() => {
      messagePage.classList.remove(inClass);
      isTurning = false;
    }, 240);
  }, 180);
}

function setOpen(open) {
  board.classList.toggle("open", open);
  board.setAttribute("aria-hidden", String(!open));
  boardTab.setAttribute("aria-expanded", String(open));
  if (open) {
    messageForm.classList.remove("compose-in", "compose-out");
    showHome();
  }
}

/* ---------- writing ---------- */

function getComposeText() {
  return composeTextareas.map(textarea => textarea.value).join("");
}

function getGlobalCaret(textarea) {
  const index = composeTextareas.indexOf(textarea);
  const precedingLength = composeTextareas.slice(0, Math.max(0, index)).reduce((total, item) => total + item.value.length, 0);
  return precedingLength + (textarea.selectionStart || 0);
}

function createComposeTextarea() {
  const textarea = element("textarea", "compose-text-page");
  textarea.maxLength = MAX_CONTENT_LENGTH;
  textarea.placeholder = "继续写在下一页……";
  composePages.insertBefore(textarea, composeMeasure);
  bindComposeTextarea(textarea);
  return textarea;
}

function showComposePage(index, focus = false, caret = null) {
  currentComposePage = Math.max(0, Math.min(index, composeTextareas.length - 1));
  composeTextareas.forEach((textarea, pageIndex) => textarea.classList.toggle("active", pageIndex === currentComposePage));
  composePageNumber.textContent = `新页 ${currentComposePage + 1} / ${composeTextareas.length}`;
  composePreviousButton.disabled = currentComposePage === 0;
  composeNextButton.disabled = currentComposePage === composeTextareas.length - 1;

  if (focus) {
    const textarea = composeTextareas[currentComposePage];
    textarea.focus();
    const position = caret === null ? textarea.value.length : Math.min(caret, textarea.value.length);
    textarea.setSelectionRange(position, position);
  }
}

function reflowComposeText(text, globalCaret = text.length, focus = false) {
  const previousComposePage = currentComposePage;
  const limitedText = text.slice(0, MAX_CONTENT_LENGTH);
  const fragments = splitByMeasuredHeight(limitedText, composeMeasure, composeMeasure.clientHeight);

  while (composeTextareas.length < fragments.length) composeTextareas.push(createComposeTextarea());
  while (composeTextareas.length > fragments.length) composeTextareas.pop().remove();
  composeTextareas.forEach((textarea, index) => {
    const value = fragments[index] || "";
    if (textarea.value !== value) textarea.value = value;
    textarea.scrollTop = 0;
  });

  const caret = Math.min(globalCaret, limitedText.length);
  let accumulated = 0;
  let targetPage = fragments.length - 1;
  let localCaret = fragments[targetPage].length;
  for (let index = 0; index < fragments.length; index += 1) {
    const end = accumulated + fragments[index].length;
    if (caret < end || index === fragments.length - 1) {
      targetPage = index;
      localCaret = caret - accumulated;
      break;
    }
    accumulated = end;
  }

  messageCount.textContent = `${limitedText.length} / ${MAX_CONTENT_LENGTH}`;
  showComposePage(targetPage, focus, localCaret);
  if (focus && targetPage !== previousComposePage) {
    const activePage = composeTextareas[targetPage];
    activePage.classList.add("compose-page-flip");
    setTimeout(() => activePage.classList.remove("compose-page-flip"), 260);
  }
}

// Chinese/Japanese input methods put the raw pinyin into the textarea while a character is being
// chosen. Re-paginating then would move those letters to the next page and break the composition,
// committing them as plain letters. So pagination waits until the input method commits the text.
let imeComposing = false;

function handleComposeInput(event) {
  const textarea = event.currentTarget;
  if (imeComposing || event.isComposing) return;
  reflowComposeText(getComposeText(), getGlobalCaret(textarea), true);
}

function bindComposeTextarea(textarea) {
  textarea.addEventListener("input", handleComposeInput);
  textarea.addEventListener("compositionstart", () => {
    imeComposing = true;
    // Let the page scroll while composing so pinyin past the last line stays visible.
    textarea.classList.add("ime-composing");
  });
  textarea.addEventListener("compositionend", event => {
    imeComposing = false;
    textarea.classList.remove("ime-composing");
    // Some browsers send no further input event after compositionend; reflow once here.
    handleComposeInput(event);
  });
  textarea.addEventListener("keydown", event => {
    if (event.isComposing || imeComposing) return;
    if (event.key !== "Backspace" || textarea.selectionStart !== 0 || textarea.selectionEnd !== 0) return;
    const pageIndex = composeTextareas.indexOf(textarea);
    if (pageIndex <= 0) return;
    event.preventDefault();
    showComposePage(pageIndex - 1, true);
  });
}

function beginCompose() {
  if (isTurning) return;
  composeReturnView = view === "compose" ? "home" : view;
  isTurning = true;
  setView("compose");
  messageStatus.textContent = "";
  messageForm.classList.remove("compose-out");
  messageForm.classList.add("compose-in");
  requestAnimationFrame(() => {
    reflowComposeText(getComposeText(), getComposeText().length, false);
    titleInput.focus();
    isTurning = false;
  });
}

function finishCompose(saved) {
  if (isTurning) return;
  isTurning = true;
  messageForm.classList.remove("compose-in");
  messageForm.classList.add("compose-out");
  setTimeout(() => {
    messageForm.classList.remove("compose-out");
    isTurning = false;
    if (saved) showReading({ latest: true, animate: "turn-in-next" });
    else if (composeReturnView === "reading") showReading({ animate: "turn-in-prev" });
    else if (composeReturnView === "toc") showToc();
    else showHome();
  }, 180);
}

/* ---------- data ---------- */

async function loadMessages() {
  try {
    const response = await window.LULU_API.request(messagesApiUrl, { cache: "no-store" });
    if (response.ok) {
      const result = await response.json();
      messages = (Array.isArray(result.messages) ? result.messages : []).map(normalizeMessage).filter(message => message.id && message.text);
      refreshViews();
      return true;
    }
  } catch {}

  messages = (Array.isArray(window.LULU_MESSAGES) ? window.LULU_MESSAGES : []).map(normalizeMessage).filter(message => message.id && message.text);
  refreshViews();
  return false;
}

function refreshViews() {
  renderHome();
  if (view === "toc") renderToc();
  if (view === "reading") rebuildReadingPages(false);
}

async function deleteMessage(id) {
  if (!confirm("确定擦掉这条留言吗？")) return;
  try {
    const response = await window.LULU_API.request(`${messagesApiUrl}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) throw new Error();
    messages = messages.filter(message => message.id !== id);
    renderHome();
    if (messages.length) rebuildReadingPages(false);
    else showToc();
  } catch {
    readingTitle.textContent = "删除失败，请稍后再试";
  }
}

/* ---------- events ---------- */

bindComposeTextarea(messageText);
boardTab.addEventListener("click", () => setOpen(!board.classList.contains("open")));
closeButton.addEventListener("click", () => setOpen(false));
writeOption.addEventListener("click", beginCompose);
readOption.addEventListener("click", showToc);
tocBack.addEventListener("click", showHome);
readingBack.addEventListener("click", showToc);
readingWrite.addEventListener("click", beginCompose);
previousButton.addEventListener("click", () => turnPage(-1));
nextButton.addEventListener("click", () => turnPage(1));
composeBackButton.addEventListener("click", () => finishCompose(false));
composePreviousButton.addEventListener("click", () => showComposePage(currentComposePage - 1, true));
composeNextButton.addEventListener("click", () => showComposePage(currentComposePage + 1, true));
titleInput.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    showComposePage(0, true, 0);
  }
});

document.addEventListener("keydown", event => {
  if (!board.classList.contains("open")) return;
  if (event.key === "Escape") {
    if (view === "compose") finishCompose(false);
    else if (view === "reading") showToc();
    else if (view === "toc") showHome();
    else setOpen(false);
    return;
  }
  if (view !== "reading") return;
  if (event.key === "ArrowLeft") turnPage(-1);
  if (event.key === "ArrowRight") turnPage(1);
});

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (view === "reading") rebuildReadingPages(false);
  }, 160);
});

messageForm.addEventListener("submit", async event => {
  event.preventDefault();
  const text = getComposeText().trim();
  const title = titleInput.value.trim().slice(0, MAX_TITLE_LENGTH);
  const button = messageForm.querySelector('button[type="submit"]');
  if (!text) {
    messageStatus.textContent = "先写下想说的话吧。";
    showComposePage(0, true);
    return;
  }

  button.disabled = true;
  messageStatus.textContent = "正在把这句话写进笔记本……";

  try {
    const response = await window.LULU_API.request(messagesApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ author: messageAuthor || "我们", content: text, mood: messageMood || null, title: title || null })
    });
    const result = await window.LULU_API.readJson(response);
    if (!response.ok) throw new Error(result.error || "保存失败");

    const refreshed = await loadMessages();
    if (!refreshed) messages.push(normalizeMessage(result.message));
    titleInput.value = "";
    reflowComposeText("", 0, false);
    messageStatus.textContent = "写好了。";
    finishCompose(true);
  } catch (error) {
    messageStatus.textContent = error.message || "暂时无法保存，请检查网络后再试。";
  } finally {
    button.disabled = false;
  }
});

setView("home");
loadMessages();
