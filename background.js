(function () {
  "use strict";

  var redirectApi = globalThis.TwitterViewerRedirect;

  var REQUEST_FILTER = {
    urls: [
      "*://x.com/*",
      "*://*.x.com/*",
      "*://twitter.com/*",
      "*://*.twitter.com/*"
    ],
    types: ["main_frame"]
  };

  function handleBeforeRequest(details) {
    if (!details || details.type !== "main_frame") {
      return {};
    }

    try {
      var target = redirectApi.buildRedirectUrl(details.url);
      if (target && target !== details.url) {
        return { redirectUrl: target };
      }
    } catch (error) {
      console.error("[X \u2192 TwitterViewer] redirect failed:", error);
    }

    return {};
  }

  globalThis.TwitterViewerRedirectHandler = {
    handleBeforeRequest: handleBeforeRequest,
    REQUEST_FILTER: REQUEST_FILTER
  };

  if (
    typeof browser !== "undefined" &&
    browser.webRequest &&
    browser.webRequest.onBeforeRequest
  ) {
    browser.webRequest.onBeforeRequest.addListener(
      handleBeforeRequest,
      REQUEST_FILTER,
      ["blocking"]
    );
  }
})();
