import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const libPath = fileURLToPath(new URL("../lib/redirect.js", import.meta.url));
const backgroundPath = fileURLToPath(new URL("../background.js", import.meta.url));
const libSource = readFileSync(libPath, "utf8");
const backgroundSource = readFileSync(backgroundPath, "utf8");

function loadSandbox({ withBrowser = false } = {}) {
  const sandbox = { URL, console };
  if (withBrowser) {
    sandbox.browser = {
      webRequest: {
        onBeforeRequest: {
          addListener(...args) {
            sandbox.browser.calls.push(args);
          }
        }
      },
      calls: []
    };
  }
  vm.createContext(sandbox);
  vm.runInContext(libSource, sandbox, { filename: libPath });
  vm.runInContext(backgroundSource, sandbox, { filename: backgroundPath });
  return sandbox;
}

function expectedRedirect(rawUrl) {
  return (
    "https://twitterviewer.net/i/share?entry=extension&url=" +
    encodeURIComponent(new URL(rawUrl).href)
  );
}

function toHost(value) {
  return JSON.parse(JSON.stringify(value));
}

test("maps supported tweet URLs and preserves query/hash", () => {
  const { TwitterViewerRedirect } = loadSandbox();
  const cases = [
    "https://x.com/SpaceX/status/1925045393307627815",
    "https://twitter.com/SpaceX/status/1925045393307627815",
    "https://www.x.com/SpaceX/status/1925045393307627815",
    "https://mobile.twitter.com/SpaceX/status/1925045393307627815/",
    "https://x.com/SpaceX/status/1925045393307627815?s=20&t=abc",
    "https://x.com/SpaceX/status/1925045393307627815#m",
    "https://x.com/SpaceX/status/1925045393307627815/photo/1",
    "https://x.com/SpaceX/status/1925045393307627815/video/2",
    "https://x.com/i/status/1925045393307627815",
    "https://x.com/i/web/status/1925045393307627815"
  ];

  for (const rawUrl of cases) {
    assert.equal(
      TwitterViewerRedirect.buildRedirectUrl(rawUrl),
      expectedRedirect(rawUrl),
      rawUrl
    );
    assert.equal(TwitterViewerRedirect.isSupportedTwitterUrl(rawUrl), true, rawUrl);
  }
});

test("maps profiles and valid hashtags", () => {
  const { TwitterViewerRedirect } = loadSandbox();
  const cases = [
    "https://x.com/NASA",
    "https://x.com/NASA/",
    "https://twitter.com/NASA?lang=en",
    "https://x.com/hashtag/Formula1",
    "https://x.com/hashtag/%D0%9D%D0%BE%D0%B2%D0%BE%D1%81%D1%82%D0%B8"
  ];

  for (const rawUrl of cases) {
    assert.equal(
      TwitterViewerRedirect.buildRedirectUrl(rawUrl),
      expectedRedirect(rawUrl),
      rawUrl
    );
  }
});

test("leaves navigation, unsupported paths, and other hosts alone", () => {
  const { TwitterViewerRedirect } = loadSandbox();
  const cases = [
    "https://x.com/",
    "https://x.com/home",
    "https://x.com/explore",
    "https://x.com/search?q=test",
    "https://x.com/messages",
    "https://x.com/notifications",
    "https://x.com/settings",
    "https://x.com/compose/post",
    "https://x.com/login",
    "https://x.com/signup",
    "https://x.com/intent/post",
    "https://x.com/i/bookmarks",
    "https://x.com/hashtag/123",
    "https://x.com/hashtag/",
    "https://x.com/NASA/media",
    "https://x.com/NASA/status/not-a-number",
    "https://x.com/NASA/status/123/analytics",
    "https://example.com/NASA/status/123456",
    "https://notx.com/NASA",
    "https://x.com.evil.test/NASA",
    "ftp://x.com/NASA",
    "not a url"
  ];

  for (const rawUrl of cases) {
    assert.equal(TwitterViewerRedirect.buildRedirectUrl(rawUrl), null, rawUrl);
    assert.equal(TwitterViewerRedirect.isSupportedTwitterUrl(rawUrl), false, rawUrl);
  }
});

test("background registers a blocking main_frame webRequest listener", () => {
  const sandbox = loadSandbox({ withBrowser: true });
  assert.equal(sandbox.browser.calls.length, 1);

  const [listener, filter, extraInfoSpec] = sandbox.browser.calls[0];
  assert.equal(typeof listener, "function");
  assert.deepEqual(toHost(extraInfoSpec), ["blocking"]);
  assert.deepEqual(toHost(filter.types), ["main_frame"]);
  assert.deepEqual(toHost(filter.urls), [
    "*://x.com/*",
    "*://*.x.com/*",
    "*://twitter.com/*",
    "*://*.twitter.com/*"
  ]);
});

test("background handler redirects main-frame X navigations only", () => {
  const sandbox = loadSandbox({ withBrowser: true });
  const handler = sandbox.TwitterViewerRedirectHandler.handleBeforeRequest;

  const redirect = handler({
    type: "main_frame",
    url: "https://x.com/SpaceX/status/1925045393307627815"
  });
  assert.deepEqual(toHost(redirect), {
    redirectUrl: expectedRedirect("https://x.com/SpaceX/status/1925045393307627815")
  });

  assert.deepEqual(
    toHost(handler({ type: "main_frame", url: "https://x.com/home" })),
    {}
  );
  assert.deepEqual(
    toHost(
      handler({
        type: "image",
        url: "https://x.com/SpaceX/status/1925045393307627815"
      })
    ),
    {}
  );
  assert.deepEqual(
    toHost(handler({ type: "main_frame", url: "https://example.com/" })),
    {}
  );
  assert.deepEqual(toHost(handler(null)), {});
  assert.deepEqual(toHost(handler({ type: "main_frame" })), {});
});

test("never redirects twitterviewer.net itself (no loops)", () => {
  const { TwitterViewerRedirect } = loadSandbox();
  assert.equal(
    TwitterViewerRedirect.buildRedirectUrl(
      "https://twitterviewer.net/i/share?entry=extension&url=https%3A%2F%2Fx.com%2FNASA"
    ),
    null
  );
});
