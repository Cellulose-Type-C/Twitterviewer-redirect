const RESEND_ENDPOINT = "https://api.resend.com/emails";

const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const MIN_MESSAGE_LENGTH = 10;
const MAX_MESSAGE_LENGTH = 5000;

const ALLOWED_SUBJECTS = new Set([
  "Installation help",
  "Bug report",
  "Feature request",
  "Privacy question",
  "Something else"
]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getContactRecipient(env) {
  const recipient = normalizeText(env && env.CONTACT_TO);
  return recipient && EMAIL_PATTERN.test(recipient) ? recipient : "";
}

function hasEmailConfig(env) {
  return Boolean(env && env.RESEND_API_KEY && getContactRecipient(env));
}

function validatePayload(body) {
  const name = normalizeText(body.name);
  const email = normalizeText(body.email);
  const subject = normalizeText(body.subject);
  const message = normalizeText(body.message);

  if (name.length > MAX_NAME_LENGTH) {
    return { error: `Name must be ${MAX_NAME_LENGTH} characters or fewer.` };
  }

  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    return { error: "Please provide a valid email address." };
  }

  if (!ALLOWED_SUBJECTS.has(subject)) {
    return { error: "Please choose a valid topic." };
  }

  if (message.length < MIN_MESSAGE_LENGTH) {
    return { error: `Message must be at least ${MIN_MESSAGE_LENGTH} characters.` };
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return { error: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.` };
  }

  return { payload: { name, email, subject, message } };
}

function buildEmail(payload) {
  const receivedAt = new Date().toISOString();
  const displayName = payload.name || "Anonymous";

  const text = [
    "New message from the TwitterViewer Redirect help site",
    "",
    `Topic: ${payload.subject}`,
    `Name: ${displayName}`,
    `Email: ${payload.email}`,
    `Received: ${receivedAt}`,
    "",
    "Message:",
    payload.message
  ].join("\n");

  const html = [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.55;color:#0f1419">',
    "<h2>New message from the TwitterViewer Redirect help site</h2>",
    '<table cellpadding="6" style="border-collapse:collapse">',
    `<tr><td><strong>Topic</strong></td><td>${escapeHtml(payload.subject)}</td></tr>`,
    `<tr><td><strong>Name</strong></td><td>${escapeHtml(displayName)}</td></tr>`,
    `<tr><td><strong>Email</strong></td><td>${escapeHtml(payload.email)}</td></tr>`,
    `<tr><td><strong>Received</strong></td><td>${escapeHtml(receivedAt)}</td></tr>`,
    "</table>",
    "<h3>Message</h3>",
    `<p style="white-space:pre-wrap">${escapeHtml(payload.message)}</p>`,
    "</div>"
  ].join("");

  return { text, html };
}

export async function handleContactPost(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "Invalid request body." }, 400);
  }

  if (normalizeText(body.website) !== "") {
    return jsonResponse({ ok: true });
  }

  const result = validatePayload(body);
  if (result.error) {
    return jsonResponse({ error: result.error }, 400);
  }

  const apiKey = env && env.RESEND_API_KEY;
  const recipient = getContactRecipient(env);
  if (!apiKey || !recipient) {
    return jsonResponse({ error: "The contact form is not configured." }, 503);
  }

  const payload = result.payload;
  const { text, html } = buildEmail(payload);
  const from =
    (env && env.CONTACT_FROM) ||
    "TwitterViewer Redirect Help <onboarding@resend.dev>";

  let upstream;
  try {
    upstream = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [recipient],
        reply_to: payload.email,
        subject: `[TwitterViewer Redirect] ${payload.subject}`,
        text,
        html
      })
    });
  } catch (error) {
    console.error("Contact email request failed:", error);
    return jsonResponse({ error: "Email could not be sent right now." }, 502);
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    console.error("Contact email rejected:", upstream.status, detail);
    return jsonResponse({ error: "Email could not be sent right now." }, 502);
  }

  return jsonResponse({ ok: true });
}

export function handleContactGet() {
  return jsonResponse({ error: "Method not allowed." }, 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return jsonResponse({ ok: true, contactConfigured: hasEmailConfig(env) });
    }

    if (url.pathname === "/api/contact") {
      if (request.method === "POST") {
        return handleContactPost(request, env);
      }
      return handleContactGet();
    }

    if (url.pathname.startsWith("/api/")) {
      return jsonResponse({ error: "Not found." }, 404);
    }

    return env.ASSETS.fetch(request);
  }
};
