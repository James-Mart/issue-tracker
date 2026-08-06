#!/usr/bin/env node
// Posts to forum.cursor.com as Jared, for filing bug reports found from inside
// the tracker. Auth is Discourse's device-code flow (auth-api-version 4): a
// device request is registered here, approved by a human in a browser, and the
// resulting key comes back RSA-encrypted so it never crosses the wire in clear
// text.
//
// Credentials deliberately live OUTSIDE this plugin directory. The plugin has a
// GitHub remote, and `~/.cursor/skills_and_plugins.zip` archives the whole
// `plugins/local/**` tree — including paths this repo gitignores — so anything
// stored here would be swept into both.
//
// One identity only, by choice: reports go out under the work forum account.
// The key is bound to whichever account approved it and is unrelated to
// CURSOR_API_KEY, so signing into a different Cursor account does not affect
// it. Re-run `register` to rebind to a different forum account.

import {
  constants,
  generateKeyPairSync,
  privateDecrypt,
  randomBytes,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CRED_DIR =
  process.env.FORUM_CRED_DIR ?? "/root/.cursor/credentials/issue-tracker-forum";
const BASE = process.env.FORUM_BASE ?? "https://forum.cursor.com";
const APPLICATION_NAME = "Issue Tracker Bug Reports";
const SCOPES = "write";
const PADDING = "oaep";

const PRIVATE_KEY = join(CRED_DIR, "private.pem");
const CLIENT = join(CRED_DIR, "client.json");
const PENDING = join(CRED_DIR, "pending.json");
const KEY = join(CRED_DIR, "key.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeSecret(path, value) {
  mkdirSync(CRED_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(path, value, { mode: 0o600 });
}

async function api(path, { method = "GET", body, apiKey } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (apiKey) headers["User-Api-Key"] = apiKey;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { status: res.status, json };
}

async function register() {
  const existing = existsSync(CLIENT) ? readJson(CLIENT) : null;

  let publicKey;
  if (existsSync(PRIVATE_KEY) && existing?.publicKey) {
    publicKey = existing.publicKey;
  } else {
    const pair = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    writeSecret(PRIVATE_KEY, pair.privateKey);
    publicKey = pair.publicKey;
  }

  const clientId = existing?.clientId ?? randomBytes(16).toString("hex");
  const nonce = randomBytes(16).toString("hex");
  writeSecret(CLIENT, JSON.stringify({ clientId, publicKey }, null, 2));

  const { status, json } = await api("/user-api-key/device", {
    method: "POST",
    body: {
      nonce,
      scopes: SCOPES,
      client_id: clientId,
      application_name: APPLICATION_NAME,
      public_key: publicKey,
      padding: PADDING,
    },
  });

  if (status !== 200 || !json.device_code) {
    console.error(`register failed (${status}):`, JSON.stringify(json));
    process.exit(1);
  }

  writeSecret(
    PENDING,
    JSON.stringify({ ...json, nonce, requestedAt: new Date().toISOString() }, null, 2),
  );

  console.log(`user_code:    ${json.user_code}`);
  console.log(`approve_url:  ${json.verification_uri_with_request}`);
  console.log(`expires_in:   ${json.expires_in}s`);
}

/**
 * Poll until the human approves. The authorized payload is consumed on first
 * read and lives only a minute, so this must already be running when they
 * click approve.
 */
async function poll() {
  const pending = readJson(PENDING);
  const privateKey = readFileSync(PRIVATE_KEY, "utf8");
  const intervalMs = (pending.interval ?? 5) * 1000;
  const deadline = Date.now() + (pending.expires_in ?? 600) * 1000;

  while (Date.now() < deadline) {
    const { status, json } = await api("/user-api-key/device/poll", {
      method: "POST",
      body: { device_code: pending.device_code },
    });

    if (status !== 200) {
      console.error(`poll failed (${status}):`, JSON.stringify(json));
      process.exit(1);
    }

    if (json.status === "authorized") {
      const plaintext = privateDecrypt(
        { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" },
        Buffer.from(json.payload, "base64"),
      ).toString("utf8");
      const payload = JSON.parse(plaintext);
      if (payload.nonce !== pending.nonce) {
        console.error("nonce mismatch — refusing payload");
        process.exit(1);
      }
      writeSecret(
        KEY,
        JSON.stringify(
          {
            key: payload.key,
            api: payload.api,
            expiresAt: payload.expires_at ?? null,
            authorizedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
      console.log(`authorized (expires ${payload.expires_at ?? "never"})`);
      return;
    }

    if (json.status !== "authorization_pending") {
      console.error(`stopped: ${json.status}`);
      process.exit(1);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  console.error("timed out waiting for approval");
  process.exit(1);
}

async function whoami() {
  const { key } = readJson(KEY);
  const { status, json } = await api("/session/current.json", { apiKey: key });
  const user = json.current_user ?? json;
  console.log(status, user.username ?? JSON.stringify(user).slice(0, 200));
}

async function post() {
  const { key } = readJson(KEY);
  const inputPath = process.argv[3];
  if (!inputPath) {
    console.error("usage: forum.mjs post <draft.json>");
    process.exit(1);
  }
  const draft = readJson(inputPath);
  // A draft carrying `topic_id` replies to an existing report; otherwise it
  // opens a new one. Replying is the common case — duplicates help nobody.
  const body =
    draft.topic_id === undefined
      ? {
          title: draft.title,
          raw: draft.raw,
          ...(draft.category === undefined ? {} : { category: draft.category }),
          ...(draft.tags === undefined ? {} : { tags: draft.tags }),
        }
      : { topic_id: draft.topic_id, raw: draft.raw };

  const { status, json } = await api("/posts.json", {
    method: "POST",
    apiKey: key,
    body,
  });
  if (status !== 200) {
    console.error(`post failed (${status}):`, JSON.stringify(json).slice(0, 600));
    process.exit(1);
  }
  console.log(`${BASE}/t/${json.topic_slug}/${json.topic_id}/${json.post_number}`);
}

const commands = { register, poll, whoami, post };
const command = process.argv[2];
if (!commands[command]) {
  console.error(`usage: forum.mjs <${Object.keys(commands).join("|")}>`);
  process.exit(1);
}
await commands[command]();
