// Runs the real Worker and a local D1 database against fake WhatsApp and Groq servers.
// Nothing leaves this machine, so no accounts or keys are needed.
import { spawn, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WORKER_PORT = 8799;
const MOCK_PORT = 8798;
const WORKER = `http://127.0.0.1:${WORKER_PORT}`;
const SECRET = "test-secret";
const ADMIN = "test-admin";
const PHONE_ID = "111";
const MONTHLY_LIMIT = 16;
const PER_HOUR = 5;

const sent = [];
const llmCalls = [];

const mock = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const data = JSON.parse(body || "{}");
    res.setHeader("content-type", "application/json");

    if (req.url.endsWith(`/${PHONE_ID}/messages`)) {
      if (data.to === "390000000000") {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { code: 131047, message: "window closed" } }));
        return;
      }
      sent.push({ to: data.to, text: data.text.body, previewUrl: data.text.preview_url });
      res.end(JSON.stringify({ messages: [{ id: "wamid.out" }] }));
      return;
    }

    if (req.url.endsWith("/chat/completions")) {
      llmCalls.push(data);
      const last = data.messages.at(-1).content;
      const fail =
        (last === "FAILPRIMARY" && data.model === "primary") || last === "FAILALL";
      if (fail) {
        res.statusCode = 429;
        res.end("{}");
        return;
      }
      const content = last === "UNKNOWN" ? "[HANDOFF]" : `reply from ${data.model}`;
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
      return;
    }

    res.statusCode = 404;
    res.end("{}");
  });
});

let nextId = 0;
const nowSeconds = () => Math.floor(Date.now() / 1000);

function textMessage(from, body, overrides = {}) {
  return {
    id: `wamid.${++nextId}`,
    from,
    timestamp: String(nowSeconds()),
    type: "text",
    text: { body },
    ...overrides,
  };
}

function webhookBody(messages) {
  return JSON.stringify({
    entry: [{ changes: [{ value: { metadata: { phone_number_id: PHONE_ID }, messages } }] }],
  });
}

function postSigned(body, secret = SECRET) {
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  return fetch(`${WORKER}/webhook/whatsapp`, {
    method: "POST",
    headers: { "x-hub-signature-256": `sha256=${signature}` },
    body,
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sends a webhook and waits for the background work to finish. */
async function deliver(messages, expectedSends) {
  const before = sent.length;
  const response = await postSigned(webhookBody(messages));
  if (response.status !== 200) throw new Error(`webhook returned ${response.status}`);
  const deadline = Date.now() + 8000;
  while (sent.length - before < expectedSends && Date.now() < deadline) await sleep(50);
  await sleep(expectedSends === 0 ? 700 : 150);
  return sent.slice(before);
}

const admin = (path, init = {}) =>
  fetch(`${WORKER}/admin/whatsapp${path}`, {
    ...init,
    headers: { authorization: `Bearer ${ADMIN}`, ...init.headers },
  });

let passed = 0;
const failures = [];
function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name} ${detail}`);
  }
}

async function scenarios() {
  console.log("Webhook setup");
  const verify = (token) =>
    fetch(
      `${WORKER}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=12345`,
    );
  const verified = await verify("test-verify");
  check("correct token returns the challenge", (await verified.text()) === "12345");
  check("wrong token is refused", (await verify("nope")).status === 403);
  check("unknown channel is 404", (await fetch(`${WORKER}/webhook/nope`)).status === 404);

  console.log("Security");
  const forged = await postSigned(webhookBody([textMessage("391", "hi")]), "wrong-secret");
  check("forged signature is refused", forged.status === 401);
  const unsigned = await fetch(`${WORKER}/webhook/whatsapp`, { method: "POST", body: "{}" });
  check("missing signature is refused", unsigned.status === 401);
  await sleep(300);
  check("forged messages trigger nothing", sent.length === 0 && llmCalls.length === 0);
  check("admin without a token is refused", (await fetch(`${WORKER}/admin/whatsapp/stats`)).status === 401);
  check(
    "admin with a wrong token is refused",
    (await fetch(`${WORKER}/admin/whatsapp/stats`, { headers: { authorization: "Bearer x" } })).status === 401,
  );

  console.log("Conversation");
  const user = "393331112222";
  let out = await deliver([textMessage(user, "كام السعر؟")], 1);
  check("first text gets one reply", out.length === 1);
  check("first reply discloses the bot", out[0]?.text.startsWith("أهلًا! أنا مساعد آلي"), out[0]?.text);
  check("first reply contains the AI answer", out[0]?.text.includes("reply from primary"));
  check("link previews are off", out[0]?.previewUrl === false);

  out = await deliver([textMessage(user, "طب والتوصيل؟")], 1);
  check("second reply has no disclosure", out[0]?.text === "reply from primary", out[0]?.text);
  const lastCall = llmCalls.at(-1);
  check("system prompt is sent", lastCall.messages[0].role === "system");
  check(
    "history is sent in order",
    JSON.stringify(lastCall.messages.slice(1).map((m) => [m.role, m.content])) ===
      JSON.stringify([
        ["user", "كام السعر؟"],
        ["assistant", "reply from primary"],
        ["user", "طب والتوصيل؟"],
      ]),
  );

  console.log("Retries and non-text");
  const duplicate = textMessage("394", "ciao");
  out = await deliver([duplicate], 1);
  check("Italian contact gets the international notice", out[0]?.text.startsWith("Ciao!"));
  out = await deliver([duplicate], 0);
  check("a retried webhook is not answered twice", out.length === 0);

  out = await deliver([{ id: `wamid.${++nextId}`, from: "395", timestamp: String(nowSeconds()), type: "image" }], 1);
  check("photo gets the text-only notice", out[0]?.text.includes("solo messaggi di testo"), out[0]?.text);

  out = await deliver([{ id: `wamid.${++nextId}`, from: "395", timestamp: String(nowSeconds()), type: "reaction" }], 0);
  check("reaction is ignored", out.length === 0);

  out = await deliver([textMessage("396", "old", { timestamp: String(nowSeconds() - 86400) })], 0);
  check("a day-old message is ignored", out.length === 0);

  console.log("AI failures");
  out = await deliver([textMessage("397", "FAILPRIMARY")], 1);
  check("fallback model answers when the main one is limited", out[0]?.text.includes("reply from fallback"), out[0]?.text);
  out = await deliver([textMessage("397", "FAILALL")], 1);
  check("customer gets a clear message when both fail", out[0]?.text.includes("Mi dispiace"), out[0]?.text);

  console.log("Handoff to a person");
  const customer = "393330000398";
  out = await deliver([textMessage(customer, "عايز اكلم موظف")], 1);
  check("asking for a person gets a confirmation", out[0]?.text.includes("طلبك وصل لموظف"), out[0]?.text);
  const callsBefore = llmCalls.length;
  out = await deliver([textMessage(customer, "فين الموظف؟")], 0);
  check("bot stays silent during a handoff", out.length === 0 && llmCalls.length === callsBefore);

  const handoffs = await (await admin("/handoffs")).json();
  check("handoff appears in the admin list", handoffs.handoffs.some((h) => h.user_id === customer));

  const before = sent.length;
  const reply = await admin(`/conversations/${customer}/reply`, {
    method: "POST",
    body: JSON.stringify({ text: "أهلًا، معاك محمود" }),
  });
  check("person can reply through admin", reply.status === 200 && sent[before]?.text === "أهلًا، معاك محمود");

  const emptyReply = await admin(`/conversations/${customer}/reply`, { method: "POST", body: "{}" });
  check("empty admin reply is refused", emptyReply.status === 400);

  const history = await (await admin(`/conversations/${customer}`)).json();
  check("conversation shows every side", history.messages.map((m) => m.role).join() === "user,bot,user,human");

  await admin(`/conversations/${customer}/resume`, { method: "POST" });
  out = await deliver([textMessage(customer, "شكرا")], 1);
  check("bot answers again after resume", out[0]?.text === "reply from primary", out[0]?.text);
  await admin(`/conversations/${customer}/resume`, { method: "POST" });

  out = await deliver([textMessage("399", "UNKNOWN")], 1);
  check("unanswerable question hands off without leaking the marker", out[0]?.text.includes("operatore") && !out[0]?.text.includes("[HANDOFF]"), out[0]?.text);

  console.log("Failed sends and limits");
  const usageBefore = (await (await admin("/stats")).json()).month_sent;
  await deliver([textMessage("390000000000", "hello")], 0);
  const usageAfter = (await (await admin("/stats")).json()).month_sent;
  check("a rejected send does not use the allowance", usageBefore === usageAfter, `${usageBefore} -> ${usageAfter}`);

  const flooder = "3977";
  let floodReplies = 0;
  for (let i = 0; i < PER_HOUR + 2; i++) {
    floodReplies += (await deliver([textMessage(flooder, `spam ${i}`)], i < PER_HOUR ? 1 : 0)).length;
  }
  check(`one person is capped at ${PER_HOUR} replies an hour`, floodReplies === PER_HOUR, `got ${floodReplies}`);

  // Use whatever allowance is left, then confirm nothing goes beyond it.
  let used = (await (await admin("/stats")).json()).month_sent;
  let filler = 5000;
  while (used < MONTHLY_LIMIT) {
    await deliver([textMessage(String(++filler), "fill")], 1);
    used = (await (await admin("/stats")).json()).month_sent;
  }
  out = await deliver([textMessage("39888", "over the limit")], 0);
  check("monthly limit stops all replies", out.length === 0);
  const overLimit = await admin(`/conversations/${customer}/reply`, {
    method: "POST",
    body: JSON.stringify({ text: "hi" }),
  });
  check("monthly limit also covers admin replies", overLimit.status === 429);
  const finalUsage = (await (await admin("/stats")).json()).month_sent;
  check("usage never exceeds the limit", finalUsage === MONTHLY_LIMIT, String(finalUsage));

  console.log("Privacy");
  const del = await admin(`/conversations/${user}`, { method: "DELETE" });
  const afterDelete = await (await admin(`/conversations/${user}`)).json();
  check("a customer's data can be deleted", del.status === 200 && afterDelete.messages.length === 0);
  const cron = await fetch(`${WORKER}/__scheduled?cron=17+3+*+*+*`);
  check("scheduled cleanup runs", cron.status === 200, String(cron.status));
}

async function main() {
  await new Promise((resolve) => mock.listen(MOCK_PORT, "127.0.0.1", resolve));
  const state = mkdtempSync(join(tmpdir(), "wa-bot-e2e-"));
  const env = { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" };

  const migrate = spawnSync(
    "npx",
    ["wrangler", "d1", "migrations", "apply", "whatsapp-bot", "--local", "--persist-to", state],
    { env, encoding: "utf8" },
  );
  if (migrate.status !== 0) throw new Error(`Migration failed:\n${migrate.stdout}${migrate.stderr}`);

  const vars = {
    WHATSAPP_ACCESS_TOKEN: "token",
    WHATSAPP_APP_SECRET: SECRET,
    WHATSAPP_VERIFY_TOKEN: "test-verify",
    WHATSAPP_PHONE_NUMBER_ID: PHONE_ID,
    GROQ_API_KEY: "key",
    ADMIN_TOKEN: ADMIN,
    GROQ_MODEL: "primary",
    GROQ_FALLBACK_MODEL: "fallback",
    MONTHLY_REPLY_LIMIT: String(MONTHLY_LIMIT),
    MAX_USER_MSGS_PER_HOUR: String(PER_HOUR),
    GRAPH_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
    GROQ_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
  };
  const worker = spawn(
    "npx",
    [
      "wrangler", "dev", "--port", String(WORKER_PORT), "--ip", "127.0.0.1",
      "--persist-to", state, "--test-scheduled",
      ...Object.entries(vars).flatMap(([key, value]) => ["--var", `${key}:${value}`]),
    ],
    { env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let logs = "";
  worker.stdout.on("data", (chunk) => (logs += chunk));
  worker.stderr.on("data", (chunk) => (logs += chunk));

  try {
    const deadline = Date.now() + 60_000;
    while (true) {
      try {
        if ((await fetch(WORKER)).ok) break;
      } catch {}
      if (Date.now() > deadline) throw new Error(`Worker did not start:\n${logs}`);
      await sleep(250);
    }
    await scenarios();
  } catch (error) {
    failures.push(String(error));
    console.error(error);
  } finally {
    try {
      process.kill(-worker.pid, "SIGTERM");
    } catch {}
    mock.close();
    rmSync(state, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log(`Worker logs:\n${logs.slice(-3000)}`);
    process.exit(1);
  }
  process.exit(0);
}

main();
