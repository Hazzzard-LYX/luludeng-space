(function () {
  if (location.protocol === "file:") {
    const current = location.pathname.split("/").pop() || "index.html";
    location.replace("http://127.0.0.1:4173/" + current + location.search + location.hash);
    return;
  }
  if (sessionStorage.getItem("lulu-dengdeng-auth") === "granted") return;
  const current = location.pathname.split("/").pop() || "index.html";
  location.replace("login.html?next=" + encodeURIComponent(current));
})();
