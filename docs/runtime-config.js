// runtime-config.js v1
// Purpose: allow configuring the backend base URL at runtime (no rebuild) for GitHub Pages deployments.
//
// Priority order:
// 1) ?apiBaseUrl=... (URL query string)
// 2) localStorage key ADA_API_BASE_URL
// 3) window.ADA_API_BASE_URL already set elsewhere
// 4) default for non-localhost deployments

(() => {
  const isLocalhost = ["localhost", "127.0.0.1"].includes(window.location.hostname);

  const qs = new URLSearchParams(window.location.search);
  const fromQuery = qs.get("apiBaseUrl");

  let fromStorage = null;
  try {
    fromStorage = window.localStorage.getItem("ADA_API_BASE_URL");
  } catch (_) {
    // ignore (private mode / blocked storage)
  }

  const fromWindow = window.ADA_API_BASE_URL;

  const DEFAULT_PROD_API_BASE_URL = "https://ada-au40.onrender.com";

  const chosen =
    (fromQuery && fromQuery.trim()) ||
    (fromStorage && fromStorage.trim()) ||
    (fromWindow && String(fromWindow).trim()) ||
    (!isLocalhost ? DEFAULT_PROD_API_BASE_URL : null);

  if (chosen) {
    window.ADA_API_BASE_URL = chosen;
  }

  // Optional: expose what was used (useful for debug UI)
  window.ADA_RUNTIME_CONFIG = {
    apiBaseUrl: window.ADA_API_BASE_URL || null,
    source: fromQuery
      ? "querystring"
      : fromStorage
        ? "localStorage"
        : fromWindow
          ? "window"
          : (!isLocalhost ? "default" : "none"),
  };
})();
