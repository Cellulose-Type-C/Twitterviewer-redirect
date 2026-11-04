(function () {
  "use strict";

  var TARGET_ORIGIN = "https://twitterviewer.net";
  var SHARE_ENDPOINT = TARGET_ORIGIN + "/i/share";

  var TWITTER_HOST_RE = /^(?:(?:www|mobile)\.)?(?:x|twitter)\.com$/i;
  var TWEET_RE = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)(?:\/(?:photo|video)\/\d+)?\/?$/;
  var I_STATUS_RE = /^\/i\/(?:web\/)?status\/(\d+)\/?$/;
  var HASHTAG_RE = /^\/hashtag\/([^/?#]+)\/?$/;
  var PROFILE_RE = /^\/([A-Za-z0-9_]{1,15})\/?$/;
  var HASHTAG_TAG_RE = /^[\p{L}\p{N}_]+$/u;
  var ALL_DIGITS_RE = /^\p{N}+$/u;

  var RESERVED_FIRST_SEGMENTS = new Set([
    "home",
    "explore",
    "search",
    "messages",
    "notifications",
    "settings",
    "compose",
    "login",
    "signup",
    "intent",
    "i",
    "hashtag"
  ]);

  function isTwitterHost(hostname) {
    return typeof hostname === "string" && TWITTER_HOST_RE.test(hostname);
  }

  function isValidHashtag(encodedTag) {
    if (typeof encodedTag !== "string" || encodedTag === "") {
      return false;
    }

    var tag;
    try {
      tag = decodeURIComponent(encodedTag);
    } catch (error) {
      return false;
    }

    return HASHTAG_TAG_RE.test(tag) && !ALL_DIGITS_RE.test(tag);
  }

  function isSupportedPath(pathname) {
    if (typeof pathname !== "string" || pathname.charAt(0) !== "/") {
      return false;
    }

    if (TWEET_RE.test(pathname) || I_STATUS_RE.test(pathname)) {
      return true;
    }

    var hashtagMatch = pathname.match(HASHTAG_RE);
    if (hashtagMatch && isValidHashtag(hashtagMatch[1])) {
      return true;
    }

    var firstSegment = pathname.split("/")[1] || "";
    if (RESERVED_FIRST_SEGMENTS.has(firstSegment.toLowerCase())) {
      return false;
    }

    return PROFILE_RE.test(pathname);
  }

  function parseUrl(rawUrl) {
    if (typeof rawUrl !== "string" || rawUrl === "") {
      return null;
    }

    var url;
    try {
      url = new URL(rawUrl);
    } catch (error) {
      return null;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url;
  }

  function isSupportedTwitterUrl(rawUrl) {
    var url = parseUrl(rawUrl);
    return Boolean(url && isTwitterHost(url.hostname) && isSupportedPath(url.pathname));
  }

  function buildRedirectUrl(rawUrl) {
    var url = parseUrl(rawUrl);
    if (!url || !isTwitterHost(url.hostname) || !isSupportedPath(url.pathname)) {
      return null;
    }

    return SHARE_ENDPOINT + "?entry=extension&url=" + encodeURIComponent(url.href);
  }

  globalThis.TwitterViewerRedirect = {
    isTwitterHost: isTwitterHost,
    isSupportedPath: isSupportedPath,
    isSupportedTwitterUrl: isSupportedTwitterUrl,
    buildRedirectUrl: buildRedirectUrl
  };
})();
