/*
  Backend smoke verifier.
  Usage:
    node verify-smoke.js
    BASE_URL=http://127.0.0.1:8000 node verify-smoke.js
    BASE_URL=http://127.0.0.1:8000 EXPECT_PROVIDER=ollama node verify-smoke.js
*/

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:8000";
const EXPECT_PROVIDER = process.env.EXPECT_PROVIDER ? String(process.env.EXPECT_PROVIDER).trim().toLowerCase() : "";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function getJson(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`GET ${path} returned non-JSON body: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`GET ${path} failed (${res.status}): ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json;
}

async function postJson(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`POST ${path} returned non-JSON body: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`POST ${path} failed (${res.status}): ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json;
}

async function readStreamEvents(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "");
    throw new Error(`POST ${path} stream failed (${res.status}): ${txt.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const tokens = [];
  let donePayload = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() || "";

    for (const block of blocks) {
      const lines = block.split("\n");
      let event = "message";
      let data = "";

      for (const line of lines) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data += line.slice(5).trim();
      }

      if (!data) continue;
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }

      if (event === "token" && typeof parsed.token === "string") tokens.push(parsed.token);
      if (event === "done" && parsed && typeof parsed === "object") donePayload = parsed;
    }
  }

  return { tokens, donePayload };
}

async function run() {
  const checks = [];

  const health = await getJson("/api/health");
  assert(health && health.status === "ok", "Health check did not return status=ok");
  checks.push("health");

  const chat = await postJson("/api/chat-assist/ask", {
    message: "summarize cnc-1 today",
    history: [],
  });
  assert(typeof chat.answer === "string" && chat.answer.length > 0, "chat-assist/ask missing answer");
  assert(Array.isArray(chat.suggestions), "chat-assist/ask missing suggestions array");
  assert(typeof chat.provider === "string" && chat.provider.length > 0, "chat-assist/ask missing provider");
  if (EXPECT_PROVIDER) {
    assert(chat.provider.toLowerCase() === EXPECT_PROVIDER, `Expected provider=${EXPECT_PROVIDER} but got ${chat.provider}`);
  }
  checks.push(`chat(${chat.provider})`);

  const stream = await readStreamEvents("/api/chat-assist/ask-stream", {
    message: "summarize plant status",
    history: [],
  });
  assert(stream.tokens.length > 0, "chat-assist/ask-stream emitted no token events");
  assert(stream.donePayload && typeof stream.donePayload.answer === "string", "chat-assist/ask-stream missing done payload");
  if (EXPECT_PROVIDER) {
    assert(
      String(stream.donePayload.provider || "").toLowerCase() === EXPECT_PROVIDER,
      `Expected stream provider=${EXPECT_PROVIDER} but got ${stream.donePayload.provider}`
    );
  }
  checks.push(`chat-stream(tokens=${stream.tokens.length})`);

  const strategy = await postJson("/api/chat-assist/strategy", {
    goal: "Reduce rejects and improve energy efficiency",
    horizonDays: 7,
  });
  ["suggestions", "recommendations", "predictions", "ideas"].forEach((key) => {
    assert(Array.isArray(strategy[key]), `strategy missing ${key} array`);
    assert(strategy[key].length > 0, `strategy ${key} is empty`);
  });
  checks.push("strategy");

  const report = await getJson("/api/reports/intelligence-summary/document-fast");
  assert(typeof report.title === "string" && report.title.length > 0, "reports endpoint missing title");
  assert(report.kpis && typeof report.kpis === "object", "reports endpoint missing kpis object");
  checks.push("reports");

  const insights = await getJson("/api/insights/top?limit=2");
  assert(Array.isArray(insights), "insights/top did not return array");
  checks.push(`insights(${insights.length})`);

  console.log(JSON.stringify({
    ok: true,
    baseUrl: BASE_URL,
    expectedProvider: EXPECT_PROVIDER || null,
    checks,
    provider: chat.provider,
    streamProvider: stream.donePayload.provider || null,
    streamTokenCount: stream.tokens.length,
  }, null, 2));
}

run().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    baseUrl: BASE_URL,
    expectedProvider: EXPECT_PROVIDER || null,
    error: err && err.message ? err.message : String(err),
  }, null, 2));
  process.exit(1);
});
