const boardTab = document.getElementById("message-board-tab");
const board = document.getElementById("message-board");
const notebook = board.querySelector(".notebook");
const closeButton = document.getElementById("message-board-close");
const messageForm = document.getElementById("message-form");
const messageText = document.getElementById("message-text");
const messageCount = document.getElementById("message-count");
const messageStatus = document.getElementById("message-status");
const messageList = document.getElementById("message-list");
const messagesApiUrl = "https://luludeng-api.13404211257.workers.dev/api/messages";
const messageAuthor = String(window.LULU_MESSAGE_AUTHOR || "噜噜 & 噔噔").trim();
const messageMood = String(window.LULU_MESSAGE_MOOD || "love").trim();

let messages = [];
let readingPages = [];
let currentPage = 0;
let composeTextareas = [messageText];
let currentComposePage = 0;
let isTurning = false;

function normalizeMessage(message) {
  return {
    ...message,
    text: typeof message.content === "string" ? message.content : String(message.text || ""),
    createdAt: message.created_at || message.createdAt || ""
  };
}

const composeHeading = document.createElement("div");
composeHeading.className = "compose-heading";
composeHeading.innerHTML = `
  <button type="button" aria-label="返回上一页">← 返回</button>
  <span>NEW PAGE · 写给你</span>
`;
messageForm.prepend(composeHeading);

const composePages = document.createElement("div");
composePages.className = "compose-pages";
messageText.before(composePages);
messageText.classList.add("compose-text-page", "active");
composePages.append(messageText);

const composeMeasure = document.createElement("textarea");
composeMeasure.className = "compose-text-page compose-measure";
composeMeasure.tabIndex = -1;
composeMeasure.setAttribute("aria-hidden", "true");
composePages.append(composeMeasure);

const composePagination = document.createElement("nav");
composePagination.className = "compose-pagination";
composePagination.setAttribute("aria-label", "书写页翻页");
composePagination.innerHTML = `
  <button type="button" class="compose-prev" aria-label="上一张书写页">← 上一页</button>
  <span class="compose-page-number" aria-live="polite">新页 1 / 1</span>
  <button type="button" class="compose-next" aria-label="下一张书写页">下一页 →</button>
`;
composePages.after(composePagination);

const messagePage = document.createElement("div");
messagePage.className = "message-page";
messageList.before(messagePage);
messagePage.append(messageList);

const pagination = document.createElement("nav");
pagination.className = "message-pagination";
pagination.setAttribute("aria-label", "留言翻页");
pagination.innerHTML = `
  <button id="message-prev" type="button" aria-label="翻到上一页">← 上一页</button>
  <span id="message-page-number" aria-live="polite">第 1 / 1 页</span>
  <button id="message-next" type="button" aria-label="翻到下一页">下一页 →</button>
`;
messagePage.append(pagination);

const readingMeasure = document.createElement("p");
readingMeasure.className = "reading-page-measure";
readingMeasure.setAttribute("aria-hidden", "true");
notebook.append(readingMeasure);

const composeLauncher = document.createElement("section");
composeLauncher.className = "compose-launcher";
composeLauncher.innerHTML = `
  <span>NEXT PAGE</span>
  <button type="button">翻到新一页写留言&nbsp; →</button>
`;
notebook.append(composeLauncher);

const previousButton = document.getElementById("message-prev");
const nextButton = document.getElementById("message-next");
const pageNumber = document.getElementById("message-page-number");
const composeButton = composeLauncher.querySelector("button");
const composeBackButton = composeHeading.querySelector("button");
const composePreviousButton = composePagination.querySelector(".compose-prev");
const composeNextButton = composePagination.querySelector(".compose-next");
const composePageNumber = composePagination.querySelector(".compose-page-number");

function orderedMessages() {
  return messages.slice().sort((a, b) => {
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function splitByMeasuredHeight(text, measure, maxHeight) {
  if (!text) return [""];
  if (!maxHeight || maxHeight < 40) {
    const fallbackSize = 150;
    return Array.from({ length: Math.ceil(text.length / fallbackSize) }, (_, index) => {
      return text.slice(index * fallbackSize, (index + 1) * fallbackSize);
    });
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

function rebuildReadingPages(showLatest = false) {
  const oldLength = readingPages.length;
  const oldPage = currentPage;
  readingPages = [];

  const textWidth = Math.max(180, messageList.clientWidth - 18);
  const textHeight = Math.max(120, messageList.clientHeight - 88);
  readingMeasure.style.width = `${textWidth}px`;

  orderedMessages().forEach(message => {
    const fragments = splitByMeasuredHeight(message.text, readingMeasure, textHeight);
    fragments.forEach((fragment, fragmentIndex) => {
      readingPages.push({
        message,
        text: fragment,
        fragmentIndex,
        fragmentCount: fragments.length
      });
    });
  });

  if (showLatest) currentPage = Math.max(0, readingPages.length - 1);
  else if (oldLength) currentPage = Math.min(oldPage, Math.max(0, readingPages.length - 1));
  renderMessages();
}

function setOpen(open) {
  board.classList.toggle("open", open);
  board.setAttribute("aria-hidden", String(!open));
  boardTab.setAttribute("aria-expanded", String(open));

  if (open) {
    notebook.classList.remove("composing");
    messageForm.classList.remove("compose-in", "compose-out");
    requestAnimationFrame(() => rebuildReadingPages(true));
  }
}

function renderMessages() {
  const totalPages = Math.max(1, readingPages.length);
  currentPage = Math.max(0, Math.min(currentPage, totalPages - 1));
  messageList.innerHTML = "";

  if (!readingPages.length) {
    messageList.innerHTML = '<div class="message-empty"><b>还没有写过留言。</b><br>下一页，留给我们。</div>';
  } else {
    const page = readingPages[currentPage];
    const note = document.createElement("article");
    note.className = "featured-message";

    const text = document.createElement("p");
    text.textContent = page.text;

    const footer = document.createElement("footer");
    const time = document.createElement("time");
    const continuation = page.fragmentCount > 1
      ? ` · ${page.fragmentIndex + 1}/${page.fragmentCount}`
      : "";
    time.textContent = `${formatTime(page.message.createdAt)}${continuation}`;

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.setAttribute("aria-label", "删除这条留言");
    deleteButton.textContent = "×";
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

function getComposeText() {
  return composeTextareas.map(textarea => textarea.value).join("");
}

function getGlobalCaret(textarea) {
  const index = composeTextareas.indexOf(textarea);
  const precedingLength = composeTextareas
    .slice(0, Math.max(0, index))
    .reduce((total, item) => total + item.value.length, 0);
  return precedingLength + (textarea.selectionStart || 0);
}

function createComposeTextarea() {
  const textarea = document.createElement("textarea");
  textarea.className = "compose-text-page";
  textarea.maxLength = 500;
  textarea.placeholder = "继续写在下一页……";
  composePages.insertBefore(textarea, composeMeasure);
  bindComposeTextarea(textarea);
  return textarea;
}

function showComposePage(index, focus = false, caret = null) {
  currentComposePage = Math.max(0, Math.min(index, composeTextareas.length - 1));
  composeTextareas.forEach((textarea, pageIndex) => {
    textarea.classList.toggle("active", pageIndex === currentComposePage);
  });

  composePageNumber.textContent = `新页 ${currentComposePage + 1} / ${composeTextareas.length}`;
  composePreviousButton.disabled = currentComposePage === 0;
  composeNextButton.disabled = currentComposePage === composeTextareas.length - 1;

  if (focus) {
    requestAnimationFrame(() => {
      const textarea = composeTextareas[currentComposePage];
      textarea.focus();
      const position = caret === null ? textarea.value.length : Math.min(caret, textarea.value.length);
      textarea.setSelectionRange(position, position);
    });
  }
}

function reflowComposeText(text, globalCaret = text.length, focus = false) {
  const previousComposePage = currentComposePage;
  const limitedText = text.slice(0, 500);
  const availableHeight = composeMeasure.clientHeight;
  const fragments = splitByMeasuredHeight(limitedText, composeMeasure, availableHeight);

  while (composeTextareas.length < fragments.length) {
    composeTextareas.push(createComposeTextarea());
  }
  while (composeTextareas.length > fragments.length) {
    composeTextareas.pop().remove();
  }

  composeTextareas.forEach((textarea, index) => {
    textarea.value = fragments[index] || "";
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

  messageCount.textContent = `${limitedText.length} / 500`;
  showComposePage(targetPage, focus, localCaret);
  if (focus && targetPage !== previousComposePage) {
    const activePage = composeTextareas[targetPage];
    activePage.classList.add("compose-page-flip");
    setTimeout(() => activePage.classList.remove("compose-page-flip"), 260);
  }
}

function handleComposeInput(event) {
  const textarea = event.currentTarget;
  const caret = getGlobalCaret(textarea);
  reflowComposeText(getComposeText(), caret, true);
}

function bindComposeTextarea(textarea) {
  textarea.addEventListener("input", handleComposeInput);
  textarea.addEventListener("keydown", event => {
    if (event.key !== "Backspace" || textarea.selectionStart !== 0 || textarea.selectionEnd !== 0) return;
    const pageIndex = composeTextareas.indexOf(textarea);
    if (pageIndex <= 0) return;
    event.preventDefault();
    showComposePage(pageIndex - 1, true);
  });
}

function beginCompose() {
  if (isTurning) return;
  isTurning = true;
  messagePage.classList.add("turn-out-next");
  composeLauncher.classList.add("turn-out-next");

  setTimeout(() => {
    messagePage.classList.remove("turn-out-next");
    composeLauncher.classList.remove("turn-out-next");
    notebook.classList.add("composing");
    messageForm.classList.add("compose-in");
    messageStatus.textContent = "";
    void messageForm.offsetWidth;
    reflowComposeText(getComposeText(), getComposeText().length, true);
    isTurning = false;
  }, 180);
}

function finishCompose(saved) {
  if (isTurning) return;
  isTurning = true;
  messageForm.classList.remove("compose-in");
  messageForm.classList.add("compose-out");

  setTimeout(() => {
    notebook.classList.remove("composing");
    messageForm.classList.remove("compose-out");
    rebuildReadingPages(true);
    messagePage.classList.add(saved ? "turn-in-next" : "turn-in-prev");
    composeLauncher.classList.add(saved ? "turn-in-next" : "turn-in-prev");

    setTimeout(() => {
      messagePage.classList.remove("turn-in-next", "turn-in-prev");
      composeLauncher.classList.remove("turn-in-next", "turn-in-prev");
      isTurning = false;
    }, 240);
  }, 180);
}

async function loadMessages() {
  try {
    const response = await fetch(messagesApiUrl, { cache: "no-store" });
    if (response.ok) {
      const result = await response.json();
      messages = (Array.isArray(result.messages) ? result.messages : [])
        .map(normalizeMessage)
        .filter(message => message.id && message.text);
      rebuildReadingPages(true);
      return true;
    }
  } catch {}

  messages = (Array.isArray(window.LULU_MESSAGES) ? window.LULU_MESSAGES : [])
    .map(normalizeMessage)
    .filter(message => message.id && message.text);
  rebuildReadingPages(true);
  return false;
}

async function deleteMessage(id) {
  if (!confirm("确定擦掉这条留言吗？")) return;

  try {
    const response = await fetch(`${messagesApiUrl}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) throw new Error();
    messages = messages.filter(message => message.id !== id);
    rebuildReadingPages(true);
  } catch {
    composeLauncher.querySelector("span").textContent = "删除失败，请通过本地服务打开";
  }
}

bindComposeTextarea(messageText);
boardTab.addEventListener("click", () => setOpen(!board.classList.contains("open")));
closeButton.addEventListener("click", () => setOpen(false));
previousButton.addEventListener("click", () => turnPage(-1));
nextButton.addEventListener("click", () => turnPage(1));
composeButton.addEventListener("click", beginCompose);
composeBackButton.addEventListener("click", () => finishCompose(false));
composePreviousButton.addEventListener("click", () => showComposePage(currentComposePage - 1, true));
composeNextButton.addEventListener("click", () => showComposePage(currentComposePage + 1, true));

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    if (notebook.classList.contains("composing")) finishCompose(false);
    else setOpen(false);
    return;
  }

  if (!board.classList.contains("open") || notebook.classList.contains("composing")) return;
  if (event.key === "ArrowLeft") turnPage(-1);
  if (event.key === "ArrowRight") turnPage(1);
});

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!notebook.classList.contains("composing")) rebuildReadingPages(false);
  }, 160);
});

messageForm.addEventListener("submit", async event => {
  event.preventDefault();
  const text = getComposeText().trim();
  const button = messageForm.querySelector('button[type="submit"]');
  if (!text) return;

  button.disabled = true;
  messageStatus.textContent = "正在把这句话写进笔记本……";

  try {
    const response = await fetch(messagesApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        author: messageAuthor || "我们",
        content: text,
        mood: messageMood || null
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "保存失败");

    const refreshed = await loadMessages();
    if (!refreshed) messages.push(normalizeMessage(result.message));
    reflowComposeText("", 0, false);
    messageStatus.textContent = "写好了。";
    finishCompose(true);
  } catch (error) {
    messageStatus.textContent = error.message || "当前页面无法保存，请通过本地服务打开。";
  } finally {
    button.disabled = false;
  }
});

loadMessages();
