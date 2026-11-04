import test from "node:test";
import assert from "node:assert/strict";

import worker, {
  handleContactGet,
  handleContactPost,
} from "../site/_worker.js";

const CONTACT_TO = "maintainer@example.test";

function makeRequest(body, { raw = false } = {}) {
  return new Request("https://help.example/api/contact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? body : JSON.stringify(body),
  });
}

function validBody(overrides = {}) {
  return {
    name: "Ada Lovelace",
    email: "ada@example.com",
    subject: "Bug report",
    message: "The redirect does not work for one of my favorite posts.",
    website: "",
    ...overrides,
  };
}

async function call(
  body,
  env = { RESEND_API_KEY: "test-key", CONTACT_TO },
  options
) {
  const response = await handleContactPost(makeRequest(body, options), env);
  const json = await response.json();
  return { response, json };
}

async function withMockFetch(handler, run) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return handler(...args);
  };
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("rejects malformed JSON", async () => {
  const { response, json } = await call("not json", undefined, { raw: true });
  assert.equal(response.status, 400);
  assert.match(json.error, /Invalid JSON/);
});

test("rejects an invalid email", async () => {
  const { response, json } = await call(validBody({ email: "not-an-email" }));
  assert.equal(response.status, 400);
  assert.match(json.error, /valid email/);
});

test("rejects a too-short message", async () => {
  const { response, json } = await call(validBody({ message: "help" }));
  assert.equal(response.status, 400);
  assert.match(json.error, /at least 10/);
});

test("rejects an unknown topic", async () => {
  const { response, json } = await call(validBody({ subject: "Spam" }));
  assert.equal(response.status, 400);
  assert.match(json.error, /valid topic/);
});

test("silently accepts honeypot submissions without sending email", async () => {
  await withMockFetch(
    () => {
      throw new Error("fetch should not be called");
    },
    async (calls) => {
      const { response, json } = await call(validBody({ website: "http://spam" }));
      assert.equal(response.status, 200);
      assert.deepEqual(json, { ok: true });
      assert.equal(calls.length, 0);
    }
  );
});

test("returns 503 when the email backend is not configured", async () => {
  await withMockFetch(
    () => {
      throw new Error("fetch should not be called");
    },
    async (calls) => {
      const { response, json } = await call(validBody(), {});
      assert.equal(response.status, 503);
      assert.match(json.error, /not configured/);
      assert.equal(calls.length, 0);
    }
  );
});

test("returns 503 when CONTACT_TO is missing or invalid", async () => {
  await withMockFetch(
    () => {
      throw new Error("fetch should not be called");
    },
    async (calls) => {
      const withoutTo = await call(validBody(), { RESEND_API_KEY: "test-key" });
      assert.equal(withoutTo.response.status, 503);

      const invalidTo = await call(validBody(), {
        RESEND_API_KEY: "test-key",
        CONTACT_TO: "not-an-email",
      });
      assert.equal(invalidTo.response.status, 503);
      assert.equal(calls.length, 0);
    }
  );
});

test("sends a valid message through Resend to the maintainer address", async () => {
  await withMockFetch(
    () =>
      new Response(JSON.stringify({ id: "email-123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    async (calls) => {
      const body = validBody({
        message: 'Crash on <script>alert("x")</script> links in the help page.',
      });
      const { response, json } = await call(body);

      assert.equal(response.status, 200);
      assert.deepEqual(json, { ok: true });
      assert.equal(calls.length, 1);

      const [url, init] = calls[0];
      assert.equal(url, "https://api.resend.com/emails");
      assert.equal(init.method, "POST");
      assert.equal(init.headers.authorization, "Bearer test-key");
      assert.equal(init.headers["content-type"], "application/json");

      const email = JSON.parse(init.body);
      assert.deepEqual(email.to, [CONTACT_TO]);
      assert.equal(email.reply_to, body.email);
      assert.equal(email.subject, "[TwitterViewer Redirect] Bug report");
      assert.match(email.text, /ada@example\.com/);
      assert.match(email.text, /Crash on/);
      assert.doesNotMatch(email.html, /<script>/);
      assert.match(email.html, /&lt;script&gt;/);
    }
  );
});

test("uses CONTACT_FROM when configured", async () => {
  await withMockFetch(
    () => new Response("{}", { status: 200 }),
    async (calls) => {
      const env = {
        RESEND_API_KEY: "test-key",
        CONTACT_TO,
        CONTACT_FROM: "Help Desk <help@example.org>",
      };
      const { response } = await call(validBody(), env);
      assert.equal(response.status, 200);

      const email = JSON.parse(calls[0][1].body);
      assert.equal(email.from, "Help Desk <help@example.org>");
    }
  );
});

test("returns 502 when Resend rejects the message", async () => {
  await withMockFetch(
    () => new Response('{"message":"domain not verified"}', { status: 422 }),
    async () => {
      const { response, json } = await call(validBody());
      assert.equal(response.status, 502);
      assert.match(json.error, /could not be sent/);
    }
  );
});

test("health endpoint reports configuration without exposing the address", async () => {
  const configured = await worker.fetch(
    new Request("https://help.example/api/health"),
    { RESEND_API_KEY: "test-key", CONTACT_TO }
  );
  assert.equal(configured.status, 200);
  const configuredJson = await configured.json();
  assert.deepEqual(configuredJson, { ok: true, contactConfigured: true });
  assert.doesNotMatch(JSON.stringify(configuredJson), /maintainer@example\.test/);

  const missing = await worker.fetch(
    new Request("https://help.example/api/health"),
    {}
  );
  assert.deepEqual(await missing.json(), {
    ok: true,
    contactConfigured: false,
  });

  const invalid = await worker.fetch(
    new Request("https://help.example/api/health"),
    { RESEND_API_KEY: "test-key", CONTACT_TO: "not-an-email" }
  );
  assert.deepEqual(await invalid.json(), {
    ok: true,
    contactConfigured: false,
  });
});

test("GET /api/contact is rejected with 405", async () => {
  const response = handleContactGet();
  assert.equal(response.status, 405);
  const json = await response.json();
  assert.match(json.error, /Method not allowed/);
});

test("worker routes /api/contact POST to the mail handler", async () => {
  await withMockFetch(
    () => new Response("{}", { status: 200 }),
    async () => {
      const env = {
        RESEND_API_KEY: "test-key",
        CONTACT_TO,
        ASSETS: {
          fetch: () => {
            throw new Error("assets should not be called");
          },
        },
      };
      const request = new Request("https://help.example/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validBody()),
      });
      const response = await worker.fetch(request, env);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });
    }
  );
});

test("worker serves static assets for non-API requests", async () => {
  const seen = [];
  const env = {
    ASSETS: {
      fetch: async (request) => {
        seen.push(new URL(request.url).pathname);
        return new Response("asset body", { status: 200 });
      },
    },
  };

  const page = await worker.fetch(new Request("https://help.example/"), env);
  assert.equal(await page.text(), "asset body");

  const asset = await worker.fetch(
    new Request("https://help.example/assets/styles.css"),
    env
  );
  assert.equal(await asset.text(), "asset body");

  assert.deepEqual(seen, ["/", "/assets/styles.css"]);
});

test("worker returns 404 JSON for unknown API routes", async () => {
  const env = {
    ASSETS: {
      fetch: () => {
        throw new Error("assets should not be called");
      },
    },
  };
  const response = await worker.fetch(
    new Request("https://help.example/api/other"),
    env
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Not found." });
});
