// docs/spa-redirect.js v1
// GitHub Pages SPA fallback helper.
// If 404.html stored a redirect path, restore it without a full reload.
(function () {
  try {
    var key = "spa:redirect";
    var raw = sessionStorage.getItem(key);
    if (!raw) return;
    sessionStorage.removeItem(key);
    var target = raw;
    // Replace the current URL with the intended one (relative to origin)
    if (typeof history !== "undefined" && history.replaceState) {
      history.replaceState(null, "", target);
    }
  } catch (e) {
    // no-op
  }
})();
