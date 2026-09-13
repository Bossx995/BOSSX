const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  Browsers,
  fetchLatestBaileysVersion
} = require("@nuiisweety/baileys");
const P = require("pino");
const qrcode = require("qrcode-terminal");
const readline = require("readline");
const fs = require("fs");
const { spawn } = require("child_process");
const path = require("path");
const config = require("./config");
const yts = require("yt-search");
const ytdl = require("@distube/ytdl-core");

const logger = P({ level: process.env.LOG_LEVEL || "info" });
const DATA_DIR = "./bot_data";
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const OWNER_PHOTO = "./owner.jpg";
const messageStore = new Map();
const MAX_STORED_MESSAGES = 500;

const DEFAULT_SETTINGS = {
  prefix: config.PREFIX || ".",
  anticall: false,
  antibot: false,
  antidelete: false,
  anticClean: false,
  antiadmin: false,
  antisticker: false,
  antiAdminGroups: {},
  antiStickerGroups: {},
  antiStickerCounts: {},
  antiStickerLockedGroups: {},
  antiStickerLockThreshold: 5,
  antiStatusGroups: {},
  antiStatusKickGroups: {},
  antiStatusWarnings: {},
  antimention: false,
  antilink: false,
  antiLinkGroups: {},
  welcomeGroups: {},
  goodbyeGroups: {},
  welcomeEnabledGroups: {},
  goodbyeEnabledGroups: {},
  welcomePhoto: config.WELCOME_PHOTO || "welcome.jpg",
  welcomeMessage: "╭─「 WELCOME 」\n│ 🎉 Welcome {user}\n│ 👑 BOSS X Group\n╰────────────",
  goodbyeMessage: "👋 Goodbye {user}\nTake care!",
  autoGoodNight: true,
  song: true,
  botJids: [],
  // Sudo users: trusted users allowed to use the bot in private mode.
  sudoUsers: [],
  // Command access mode: private = owner + sudo users, public = all users
  // (admin-only commands still require group admin/owner).
  mode: "private",
};

let settings = loadSettings();
if (!settings.mode) {
  settings.mode = config.MODE === "public" ? "public" : "private";
  saveSettings();
}
if (!Array.isArray(settings.sudoUsers)) { settings.sudoUsers = []; saveSettings(); }
if (!settings.antiAdminGroups || typeof settings.antiAdminGroups !== "object" || Array.isArray(settings.antiAdminGroups)) settings.antiAdminGroups = {};
if (!settings.antiStickerGroups || typeof settings.antiStickerGroups !== "object" || Array.isArray(settings.antiStickerGroups)) settings.antiStickerGroups = {};
if (!settings.antiStickerCounts || typeof settings.antiStickerCounts !== "object" || Array.isArray(settings.antiStickerCounts)) settings.antiStickerCounts = {};
if (!settings.antiStickerLockedGroups || typeof settings.antiStickerLockedGroups !== "object" || Array.isArray(settings.antiStickerLockedGroups)) settings.antiStickerLockedGroups = {};
if (!Number.isInteger(Number(settings.antiStickerLockThreshold)) || Number(settings.antiStickerLockThreshold) < 1) settings.antiStickerLockThreshold = 5;
if (!settings.antiStatusGroups || typeof settings.antiStatusGroups !== "object" || Array.isArray(settings.antiStatusGroups)) settings.antiStatusGroups = {};
if (!settings.antiStatusKickGroups || typeof settings.antiStatusKickGroups !== "object" || Array.isArray(settings.antiStatusKickGroups)) settings.antiStatusKickGroups = {};
if (!settings.antiStatusWarnings || typeof settings.antiStatusWarnings !== "object" || Array.isArray(settings.antiStatusWarnings)) settings.antiStatusWarnings = {};
if (!settings.antiLinkGroups || typeof settings.antiLinkGroups !== "object" || Array.isArray(settings.antiLinkGroups)) settings.antiLinkGroups = {};
if (!settings.welcomeGroups || typeof settings.welcomeGroups !== "object" || Array.isArray(settings.welcomeGroups)) settings.welcomeGroups = {};
if (!settings.goodbyeGroups || typeof settings.goodbyeGroups !== "object" || Array.isArray(settings.goodbyeGroups)) settings.goodbyeGroups = {};
if (!settings.welcomeEnabledGroups || typeof settings.welcomeEnabledGroups !== "object" || Array.isArray(settings.welcomeEnabledGroups)) settings.welcomeEnabledGroups = {};
if (!settings.goodbyeEnabledGroups || typeof settings.goodbyeEnabledGroups !== "object" || Array.isArray(settings.goodbyeEnabledGroups)) settings.goodbyeEnabledGroups = {};
let pairingAsked = false;

function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function loadSettings() {
  ensureData();
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
function saveSettings() {
  ensureData();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

function getBotPrefix() {
  const value = String(settings.prefix ?? config.PREFIX ?? ".").trim();
  return value || ".";
}

function getBotAccountName(sock) {
  return String(
    sock?.user?.name ||
    sock?.user?.verifiedName ||
    sock?.user?.notify ||
    config.OWNER_NAME ||
    "BOSS X"
  ).trim();
}

function setBotPrefix(value) {
  const prefix = String(value || "").trim();
  if (!prefix || /\s/u.test(prefix) || Array.from(prefix).length > 20) return null;
  settings.prefix = prefix;
  saveSettings();
  return prefix;
}
function formatGroupMessage(template, participants, groupName = "") {
  const users = Array.from(new Set((participants || []).filter(Boolean)));
  const list = users.map(p => `@${baseNumber(p)}`).join(" ");
  return String(template || "")
    .replace(/\{user\}/gi, list || "everyone")
    .replace(/\{count\}/gi, String(users.length))
    .replace(/\{group\}/gi, groupName || "this group");
}

function cleanCustomMessage(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function saveCustomGroupMessage(key, value) {
  const cleaned = cleanCustomMessage(value);
  if (!cleaned) return { ok: false, error: "empty" };
  if (cleaned.length > 4000) return { ok: false, error: "long" };
  settings[key] = cleaned;
  saveSettings();
  return { ok: true, value: cleaned };
}
function isGroup(jid) {
  return typeof jid === "string" && jid.endsWith("@g.us");
}

function baseNumber(jid) {
  return String(jid || "").split("@")[0].split(":")[0];
}
function normalizeJid(value) {
  if (!value) return "";
  if (String(value).includes("@")) return String(value);
  const digits = String(value).replace(/\D/g, "");
  return digits ? `${digits}@s.whatsapp.net` : "";
}
function unwrapMessage(message) {
  let m = message;
  for (let i = 0; i < 5 && m; i++) {
    if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
    else if (m.viewOnceMessage?.message) m = m.viewOnceMessage.message;
    else if (m.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;
    else if (m.viewOnceMessageV2Extension?.message) m = m.viewOnceMessageV2Extension.message;
    else break;
  }
  return m || {};
}
function getText(msg) {
  const m = unwrapMessage(msg?.message);
  return m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    "";
}
function getContextInfo(msg) {
  const m = unwrapMessage(msg?.message);
  return m.extendedTextMessage?.contextInfo ||
    m.imageMessage?.contextInfo ||
    m.videoMessage?.contextInfo ||
    m.documentMessage?.contextInfo ||
    m.buttonsResponseMessage?.contextInfo ||
    m.listResponseMessage?.contextInfo ||
    {};
}
function rememberMessage(msg) {
  if (!msg?.key?.id || msg.key.fromMe || !msg.message) return;
  messageStore.set(msg.key.id, msg);
  while (messageStore.size > MAX_STORED_MESSAGES) {
    messageStore.delete(messageStore.keys().next().value);
  }
}

function participantMatchesJid(participant, who) {
  if (!participant || !who) return false;
  const target = String(who);
  const targetBase = baseNumber(target);
  const targetDigits = targetBase.replace(/\D/g, "");
  return [participant.id, participant.lid, participant.phoneNumber, participant.jid, participant.wid]
    .filter(Boolean)
    .some(value => {
      const v = String(value);
      const vb = baseNumber(v);
      const vd = vb.replace(/\D/g, "");
      return v === target || vb === targetBase || (targetDigits.length >= 7 && vd === targetDigits);
    });
}

async function getGroupMetadataSafe(sock, jid) {
  try { return await sock.groupMetadata(jid); } catch { return null; }
}

async function getGroupParticipant(sock, jid, who) {
  if (!isGroup(jid) || !who) return null;
  const metadata = await getGroupMetadataSafe(sock, jid);
  if (!metadata) return null;
  return (metadata.participants || []).find(p => participantMatchesJid(p, who)) || null;
}

function participantIsAdmin(participant) {
  const role = String(participant?.admin ?? participant?.role ?? participant?.rank ?? "").toLowerCase();
  return Boolean(
    participant?.admin === true ||
    participant?.isAdmin === true ||
    participant?.isSuperAdmin === true ||
    ["admin", "superadmin", "owner", "creator"].includes(role)
  );
}

function getBotIdentityValues(sock) {
  const values = [
    sock?.user?.id, sock?.user?.lid, sock?.user?.phoneNumber,
    sock?.user?.jid, sock?.user?.wid
  ].filter(Boolean).map(String);
  const numbers = new Set();
  for (const value of values) {
    const base = baseNumber(value);
    if (/^\d+$/.test(base)) numbers.add(base);
  }
  return { values: new Set(values), numbers };
}

function participantMatchesBot(sock, participant) {
  if (!participant) return false;
  const { values, numbers } = getBotIdentityValues(sock);
  return [
    participant?.id, participant?.lid, participant?.phoneNumber,
    participant?.jid, participant?.wid
  ].filter(Boolean).map(String).some(value =>
    values.has(value) || numbers.has(baseNumber(value))
  );
}

async function getGroupAdmin(sock, jid, sender, senderPn) {
  const metadata = await getGroupMetadataSafe(sock, jid);
  if (!metadata) return false;
  const candidates = [sender, senderPn].filter(Boolean).map(String);
  const participant = (metadata.participants || []).find(p => candidates.some(c => participantMatchesJid(p, c)));
  return participantIsAdmin(participant);
}

async function getBotParticipant(sock, jid) {
  if (!isGroup(jid)) return null;
  try {
    const metadata = await sock.groupMetadata(jid);
    if (!metadata) return null;
    const participants = Array.isArray(metadata.participants) ? metadata.participants : [];

    let participant = participants.find(p => participantMatchesBot(sock, p));
    if (participant) return participant;

    const botNumber = baseNumber(sock?.user?.phoneNumber || sock?.user?.id || "");
    if (/^\d+$/.test(botNumber)) {
      participant = participants.find(p =>
        [p?.phoneNumber, p?.id, p?.jid, p?.wid]
          .filter(Boolean).some(v => baseNumber(v) === botNumber)
      );
      if (participant) return participant;
    }
    return null;
  } catch (err) {
    logger.error({ err, jid }, "bot participant lookup failed");
    return null;
  }
}

async function isBotAdmin(sock, jid) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const participant = await getBotParticipant(sock, jid);
    if (participantIsAdmin(participant)) return true;

    if (attempt === 1 && typeof sock?.groupFetchAllParticipating === "function") {
      try { await sock.groupFetchAllParticipating(); }
      catch (err) { logger.debug?.({ err, jid }, "group cache refresh failed"); }
    }
    if (attempt < 3) await new Promise(r => setTimeout(r, 700));
  }
  return false;
}

async function resolveParticipantJid(sock, jid, who) {
  const p = await getGroupParticipant(sock, jid, who);
  // Prefer the participant id currently advertised by groupMetadata.
  // Newer WhatsApp groups can expose LID + phoneNumber together, so keep
  // both as fallbacks for hosts/Baileys versions that expect one or the other.
  return p?.id || p?.phoneNumber || p?.lid || who;
}

async function removeParticipantRobust(sock, jid, who) {
  const p = await getGroupParticipant(sock, jid, who);
  const candidates = Array.from(new Set([p?.id, p?.phoneNumber, p?.lid, who].filter(Boolean).map(String)));
  let lastError = null;
  for (const target of candidates) {
    try {
      const result = await sock.groupParticipantsUpdate(jid, [target], "remove");
      const ok = !Array.isArray(result) || result.some(r => ["200", "207", 200, 207].includes(r?.status));
      if (ok) return { ok: true, target, result };
      lastError = new Error(String(result?.[0]?.status || "WhatsApp rejected removal"));
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("Participant removal failed");
}

function containsLink(text) {
  const value = String(text || "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[()[\]{}<>]/g, " ");

  // Detect common URLs, invite links and bare domains. Keep this deliberately
  // broad because users often send links without https://.
  const urlPattern =
    /(?:https?:\/\/|ftp:\/\/|www\.)\S+|(?:chat\.)?whatsapp\.com(?:\/invite)?\/[A-Za-z0-9_-]+|wa\.me\/\S+|(?:t\.me|telegram\.me)\/\S+|discord(?:\.gg|\.com\/invite)\/\S+|(?:instagram|facebook|m\.facebook|youtube|youtu|x|twitter|bit\.ly|tinyurl)\.com?\S*|(?:[a-z0-9-]+\.)+(?:com|net|org|info|biz|xyz|online|site|app|dev|io|co|in|me|ly|gg|tv|live)(?:\/\S*)?/i;

  return urlPattern.test(value);
}

function containsLinkInMessage(msg) {
  const text = getText(msg);
  if (containsLink(text)) return true;

  // Some WhatsApp message types expose a URL in metadata even when the
  // visible text/caption is empty.
  const m = unwrapMessage(msg?.message);
  const candidates = [
    m?.extendedTextMessage?.matchedText,
    m?.extendedTextMessage?.canonicalUrl,
    m?.extendedTextMessage?.description,
    m?.linkPreviewMessage?.canonicalUrl,
    m?.linkPreviewMessage?.description,
    m?.imageMessage?.caption,
    m?.videoMessage?.caption,
    m?.documentMessage?.caption
  ].filter(Boolean);

  return candidates.some(containsLink);
}

function getQuotedMessage(msg) {
  const ctx = getContextInfo(msg);
  if (!ctx?.quotedMessage) return null;
  return {
    key: {
      remoteJid: msg.key.remoteJid,
      id: ctx.stanzaId,
      participant: ctx.participant,
      fromMe: false
    },
    message: ctx.quotedMessage
  };
}

async function sendFullImage(sock, jid, quoted) {
  if (!quoted?.message) throw new Error("কোনো quoted photo পাওয়া যায়নি।");
  const qm = unwrapMessage(quoted.message);
  if (!qm.imageMessage) throw new Error(`${getBotPrefix()}lol শুধু photo/image message-এ reply করে ব্যবহার করুন।`);
  const buffer = await downloadMediaMessage(
    quoted, "buffer", {}, { logger: P({ level: "silent" }) }
  );
  return await sock.sendMessage(jid, {
    image: buffer,
    caption: qm.imageMessage.caption || "",
  });
}

function isOwner(sender) {
  return baseNumber(sender) === baseNumber(normalizeJid(config.OWNER_NUMBER));
}

function isSudo(sender, senderPn) {
  const users = Array.isArray(settings.sudoUsers) ? settings.sudoUsers : [];
  return users.some(j => baseNumber(j) === baseNumber(sender) || baseNumber(j) === baseNumber(senderPn));
}

function addSudo(value) {
  const jid = normalizeJid(value);
  if (!jid) return null;
  if (!Array.isArray(settings.sudoUsers)) settings.sudoUsers = [];
  if (!settings.sudoUsers.some(j => baseNumber(j) === baseNumber(jid))) {
    settings.sudoUsers.push(jid);
    saveSettings();
  }
  return jid;
}

function removeSudo(value) {
  const jid = normalizeJid(value);
  if (!jid) return null;
  const before = settings.sudoUsers.length;
  settings.sudoUsers = settings.sudoUsers.filter(j => baseNumber(j) !== baseNumber(jid));
  saveSettings();
  return { jid, removed: before !== settings.sudoUsers.length };
}

async function requireAdmin(sock, jid, sender, senderPn) {
  // Owner can always use admin commands, including in the owner's private/self chat.
  if (isOwner(sender) || isOwner(senderPn)) return true;
  if (!isGroup(jid)) return false;
  return getGroupAdmin(sock, jid, sender, senderPn);
}

function getChannelContextInfo(existing = {}) {
  return {
    ...existing,
    isForwarded: true,
    forwardingScore: Math.max(Number(existing.forwardingScore || 0), 1),
    forwardedNewsletterMessageInfo: {
      ...(existing.forwardedNewsletterMessageInfo || {}),
      newsletterJid: config.CHANNEL_ID || "120363412006298804@newsletter",
      newsletterName: config.CHANNEL_NAME || config.OWNER_NAME || "BOSS X",
      serverMessageId: Number(existing.forwardedNewsletterMessageInfo?.serverMessageId || 1),
      contentType: existing.forwardedNewsletterMessageInfo?.contentType || "UPDATE"
    }
  };
}

async function sendBotReply(sock, jid, text, options = {}) {
  // Owner photo/card is disabled for all command replies.
  const result = await sendTextSafe(sock, jid, text, options);
  try {
    if (result?.key) {
      await sock.sendMessage(jid, {
        react: { text: "🅱️", key: result.key }
      });
    }
  } catch (e) {
    console.warn("⚠️ Could not add B reaction:", e.message || e);
  }
  return result;
}

async function sendTextSafe(sock, jid, text, options = {}) {
  // Attach the configured WhatsApp Channel as forwarded newsletter metadata.
  // Baileys uses the correct field name: forwardedNewsletterMessageInfo.
  const contextInfo = getChannelContextInfo(options.contextInfo || {});
  const messageOptions = { text, ...options, contextInfo };
  try {
    return await sock.sendMessage(jid, messageOptions);
  } catch (e) {
    const code = e?.output?.statusCode || e?.statusCode;
    if (code === 408 || /timed out|request time-out/i.test(e?.message || "")) {
      console.warn("⚠️ WhatsApp send timed out (408). Retrying once...");
      await new Promise(r => setTimeout(r, 3000));
      return await sock.sendMessage(jid, messageOptions);
    }
    throw e;
  }
}

async function sendOwnerPhoto(sock, jid, caption, options = {}) {
  // Owner photo/card is intentionally disabled. Keep only the owner name/text.
  return await sendTextSafe(sock, jid, caption, options);
}

async function sendOwnerPhotoReply(sock, jid, caption, options = {}) {
  // Owner photo/card is intentionally disabled; send the owner name/text only.
  const result = await sendTextSafe(sock, jid, caption, options);
  try {
    if (result?.key) {
      await sock.sendMessage(jid, {
        react: { text: "🅱️", key: result.key }
      });
    }
  } catch (e) {
    console.warn("⚠️ Could not add B reaction:", e.message || e);
  }
  return result;
}

async function deleteMessage(sock, jid, key) {
  if (await isBotAdmin(sock, jid)) {
    await sock.sendMessage(jid, { delete: key });
    return true;
  }
  return false;
}

async function restoreDeleted(sock, update, label) {
  const protocol = update?.update?.message?.protocolMessage;
  if (!protocol || protocol.type !== 0) return;
  const originalId = protocol.key?.id;
  const original = messageStore.get(originalId);
  if (!original) return;
  const jid = update?.key?.remoteJid || original.key.remoteJid;
  try {
    const text = getText(original);
    if (text) {
      await sock.sendMessage(jid, { text: `${label}\n\n${text}` });
      return;
    }
    const m = unwrapMessage(original.message);
    if (m.imageMessage || m.videoMessage || m.audioMessage || m.documentMessage) {
      const buffer = await downloadMediaMessage(
        original, "buffer", {}, { logger: P({ level: "silent" }) }
      );
      if (m.imageMessage) await sock.sendMessage(jid, { image: buffer, caption: `${label}\n${m.imageMessage.caption || ""}` });
      else if (m.videoMessage) await sock.sendMessage(jid, { video: buffer, caption: `${label}\n${m.videoMessage.caption || ""}` });
      else if (m.audioMessage) await sock.sendMessage(jid, { audio: buffer, mimetype: m.audioMessage.mimetype || "audio/mpeg" });
      else await sock.sendMessage(jid, { document: buffer, mimetype: m.documentMessage.mimetype || "application/octet-stream", fileName: m.documentMessage.fileName || "deleted-file" });
    }
  } catch (e) {
    logger.error({ err: e }, "restore deleted message failed");
  }
}

async function sendOwnerCommandCard(sock, jid, title, extra = "") {
  const lines = [title, `👑 ${config.OWNER_NAME}`];
  if (extra) lines.push(extra);
  return await sendOwnerPhotoReply(sock, jid, lines.join("\n"));
}

async function runYtDlpAudio(url) {
  return await new Promise((resolve, reject) => {
    const args = [
      "--no-playlist",
      "--no-warnings",
      "--quiet",
      "-f", "bestaudio/best",
      "--extract-audio",
      "--audio-format", "mp3",
      "--audio-quality", "0",
      "-o", "-"
      , url
    ];
    const proc = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    const errors = [];
    let total = 0;
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err instanceof Error ? err : new Error(String(err || "yt-dlp failed")));
    };

    proc.stdout.on("data", chunk => {
      total += chunk.length;
      if (total > 16 * 1024 * 1024) {
        proc.kill("SIGKILL");
        fail(new Error("Song file is larger than 16 MB."));
        return;
      }
      chunks.push(chunk);
    });
    proc.stderr.on("data", chunk => errors.push(chunk.toString()));
    proc.on("error", err => {
      if (err.code === "ENOENT") {
        fail(new Error("yt-dlp পাওয়া যায়নি। Termux-এ: pkg install python && pip install -U yt-dlp"));
      } else fail(err);
    });
    proc.on("close", code => {
      if (settled) return;
      if (code !== 0) {
        fail(new Error((errors.join("").trim() || `yt-dlp exited with code ${code}`).slice(-1200)));
        return;
      }
      settled = true;
      resolve(Buffer.concat(chunks));
    });
  });
}

async function sendSong(sock, jid, query) {
  if (!query) throw new Error(`Usage: ${getBotPrefix()}song <song name or YouTube URL>`);

  let url = query.trim();
  let title = "Song";

  if (!ytdl.validateURL(url)) {
    const result = await yts(query);
    const video = result?.videos?.[0];
    if (!video) throw new Error("Song পাওয়া যায়নি।");
    url = video.url;
    title = video.title || title;
  } else {
    try {
      const result = await yts({ videoId: ytdl.getVideoID(url) });
      title = result?.title || title;
    } catch {}
  }

  // ytdl-core can fail against YouTube's current anti-bot/player changes.
  // Use yt-dlp as the primary downloader for better current YouTube coverage.
  let buffer;
  try {
    buffer = await runYtDlpAudio(url);
  } catch (ytErr) {
    // Keep a secondary ytdl-core path for environments where yt-dlp is not
    // installed but the legacy extractor still works.
    try {
      const stream = ytdl(url, {
        filter: "audioonly",
        quality: "highestaudio",
        highWaterMark: 1 << 25
      });
      const chunks = [];
      let size = 0;
      for await (const chunk of stream) {
        size += chunk.length;
        if (size > 16 * 1024 * 1024) throw new Error("Song file is larger than 16 MB.");
        chunks.push(chunk);
      }
      buffer = Buffer.concat(chunks);
    } catch (legacyErr) {
      throw new Error(`Song download failed. ${ytErr.message || legacyErr.message || "YouTube download error"}`);
    }
  }

  await sock.sendMessage(jid, {
    audio: buffer,
    mimetype: "audio/mpeg",
    fileName: `${title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80)}.mp3`,
    contextInfo: getChannelContextInfo()
  });
}

function isAntiAdminEnabledForGroup(jid) {
  return isGroup(jid) && settings.antiAdminGroups?.[jid] === true;
}
function setAntiAdminForGroup(jid, enabled) {
  if (!isGroup(jid)) return false;
  settings.antiAdminGroups[jid] = Boolean(enabled);
  saveSettings();
  return true;
}
function isAntiStickerEnabledForGroup(jid) {
  return isGroup(jid) && settings.antiStickerGroups?.[jid] === true;
}
function setAntiStickerForGroup(jid, enabled) {
  if (!isGroup(jid)) return false;
  settings.antiStickerGroups[jid] = Boolean(enabled);
  saveSettings();
  return true;
}


function isAntiStatusEnabledForGroup(jid) {
  return isGroup(jid) && settings.antiStatusGroups?.[jid] === true;
}
function setAntiStatusForGroup(jid, enabled) {
  if (!isGroup(jid)) return false;
  settings.antiStatusGroups[jid] = Boolean(enabled);
  if (!enabled) {
    delete settings.antiStatusWarnings[jid];
  }
  saveSettings();
  return true;
}
function isAntiStatusKickEnabledForGroup(jid) {
  return isGroup(jid) && settings.antiStatusKickGroups?.[jid] !== false;
}
function setAntiStatusKickForGroup(jid, enabled) {
  if (!isGroup(jid)) return false;
  settings.antiStatusKickGroups[jid] = Boolean(enabled);
  saveSettings();
  return true;
}
function getAntiStatusWarningCount(jid, sender) {
  const key = `${jid}:${baseNumber(sender)}`;
  return Number(settings.antiStatusWarnings?.[key] || 0);
}
function setAntiStatusWarningCount(jid, sender, count) {
  const key = `${jid}:${baseNumber(sender)}`;
  if (!settings.antiStatusWarnings) settings.antiStatusWarnings = {};
  if (count > 0) settings.antiStatusWarnings[key] = Math.min(3, count);
  else delete settings.antiStatusWarnings[key];
  saveSettings();
}
function isStatusMentionMessage(msg) {
  const m = unwrapMessage(msg?.message);
  // Baileys/WhatsApp versions have used several protocol field names for
  // the "Your status @ You mentioned this group" event. Keep all known
  // variants so anti-status works across versions.
  return Boolean(
    m?.groupStatusMentionMessage ||
    m?.groupStatusMentionMessageV2 ||
    m?.groupStatusMentionMessageV3 ||
    m?.groupMentionedMessage ||
    m?.statusMentionMessage ||
    m?.statusMentionMessageV2 ||
    m?.protocolMessage?.type === 25
  );
}

function isAntiLinkEnabledForGroup(jid) {
  return isGroup(jid) && settings.antiLinkGroups?.[jid] === true;
}
function setAntiLinkForGroup(jid, enabled) {
  if (!isGroup(jid)) return false;
  settings.antiLinkGroups[jid] = Boolean(enabled);
  saveSettings();
  return true;
}
function getGroupWelcomeMessage(jid) {
  return isGroup(jid) && settings.welcomeGroups?.[jid] ? settings.welcomeGroups[jid] : DEFAULT_SETTINGS.welcomeMessage;
}
function getGroupGoodbyeMessage(jid) {
  return isGroup(jid) && settings.goodbyeGroups?.[jid] ? settings.goodbyeGroups[jid] : DEFAULT_SETTINGS.goodbyeMessage;
}
function setGroupMessage(groupMap, jid, value) {
  if (!isGroup(jid) || !value) return false;
  groupMap[jid] = value;
  saveSettings();
  return true;
}
function resetGroupMessage(groupMap, jid) {
  if (!isGroup(jid)) return false;
  delete groupMap[jid];
  saveSettings();
  return true;
}

function isWelcomeEnabledForGroup(jid) {
  return isGroup(jid) && (
    settings.welcomeEnabledGroups?.[jid] === true ||
    Object.prototype.hasOwnProperty.call(settings.welcomeGroups || {}, jid)
  );
}
function isGoodbyeEnabledForGroup(jid) {
  return isGroup(jid) && (
    settings.goodbyeEnabledGroups?.[jid] === true ||
    Object.prototype.hasOwnProperty.call(settings.goodbyeGroups || {}, jid)
  );
}
function setWelcomeEnabledForGroup(jid, enabled) {
  if (!isGroup(jid)) return false;
  settings.welcomeEnabledGroups[jid] = Boolean(enabled);
  saveSettings();
  return true;
}
function setGoodbyeEnabledForGroup(jid, enabled) {
  if (!isGroup(jid)) return false;
  settings.goodbyeEnabledGroups[jid] = Boolean(enabled);
  saveSettings();
  return true;
}

function settingsText(currentSettingsJid = "") {
  const on = v => v ? "ON ✅" : "OFF ❌";
  const mode = settings.mode === "public" ? "PUBLIC 🌐" : "PRIVATE 🔐";
  const group = isGroup(currentSettingsJid);
  const groupAntiAdmin = group && isAntiAdminEnabledForGroup(currentSettingsJid);
  const groupAntiSticker = group && isAntiStickerEnabledForGroup(currentSettingsJid);
  const groupAntiLink = group && isAntiLinkEnabledForGroup(currentSettingsJid);
  const groupAntiStatus = group && isAntiStatusEnabledForGroup(currentSettingsJid);
  const groupAntiStatusKick = group && isAntiStatusKickEnabledForGroup(currentSettingsJid);
  return `⚙️ BOSS X SETTINGS
📌 Mode: ${mode}
👨‍💻 Developer: Mr bikramhacker
🌐 Group scope: per-group (only enabled groups)
🔐 Sudo users: ${Array.isArray(settings.sudoUsers) ? settings.sudoUsers.length : 0}

📞 Anti-call: ${on(settings.anticall)}
🤖 Anti-bot: ${on(settings.antibot)}
♻️ Anti-delete: ${on(settings.antidelete)}
🧹 Anti-clean: ${on(settings.anticClean)}
🛡️ Anti-admin: ${group ? on(groupAntiAdmin) : "GROUP ONLY"}
🧹 Anti-sticker: ${group ? on(groupAntiSticker) : "GROUP ONLY"}
🏷️ Anti-mention: ${on(settings.antimention)}
🚨 Anti-status/story: ${group ? on(groupAntiStatus) : "GROUP ONLY"}
👢 Anti-status kick: ${group ? on(groupAntiStatusKick) : "GROUP ONLY"}
🔗 Anti-link: ${group ? on(groupAntiLink) : "GROUP ONLY"}
🌙 Good night auto: ${on(settings.autoGoodNight)}
🎵 Song: ${on(settings.song)}

Use: ${getBotPrefix()}settings <feature> on/off`;
}
function changeSetting(name, value) {
  const map = {
    anticall:"anticall", antibot:"antibot", antidelete:"antidelete",
    anticlean:"anticClean", "anti-clean":"anticClean",
    antimention:"antimention", "anti-mention":"antimention", antitag:"antimention", "anti-tag":"antimention",
    antilink:"antilink", "anti-link":"antilink",
    goodnight:"autoGoodNight",
    autogoodnight:"autoGoodNight", song:"song"
  };
  const key = map[name];
  if (!key || !["on","off"].includes(value)) return null;
  settings[key] = value === "on";
  saveSettings();
  return key;
}

function getBotMode() {
  return settings.mode === "public" ? "public" : "private";
}
function setBotMode(mode) {
  settings.mode = mode === "public" ? "public" : "private";
  saveSettings();
  return settings.mode;
}
const adminCommands = new Set([
  "anticall","antibot","antidelete","anticlean","antiadmin","antisticker","antimention","antistatus","antitag","anti-link","antilink",
  "botadd","botdel","de","del","delete","kick","kickall","htag","tagall","totag","gcstory","settings","setwelcome","setgoodbye","group","open","close","link","grouplink","linkreset","resetlink","mode","welcomeonly"
]);


async function sendWelcomeMessage(sock, jid, participants, groupName = "") {
  const mentions = Array.from(new Set((participants || []).filter(Boolean)));
  const caption = formatGroupMessage(getGroupWelcomeMessage(jid), mentions, groupName);
  const configuredPhoto = String(settings.welcomePhoto || config.WELCOME_PHOTO || "welcome.jpg");
  const photoPath = path.isAbsolute(configuredPhoto)
    ? configuredPhoto
    : path.join(__dirname, configuredPhoto.replace(/^\.?[\\/]/, ""));

  if (fs.existsSync(photoPath)) {
    try {
      return await sock.sendMessage(jid, { image: fs.readFileSync(photoPath), caption, mentions });
    } catch (err) {
      logger.warn({ err }, "welcome photo send failed; falling back to text");
    }
  }
  return await sendTextSafe(sock, jid, caption, { mentions });
}

async function sendGoodbyeMessage(sock, jid, participants, groupName = "") {
  const mentions = Array.from(new Set((participants || []).filter(Boolean)));
  const caption = formatGroupMessage(getGroupGoodbyeMessage(jid), mentions, groupName);
  return await sendTextSafe(sock, jid, caption, { mentions });
}

async function handleMessage(sock, msg) {
  if (!msg?.message) return;

  // IMPORTANT: Commands from the same WhatsApp number (fromMe=true)
  // are intentionally processed. This allows self-command usage such as
  // ping, .menu and .settings from the paired bot number.
  // Detect commands from the actual paired bot account, not only fromMe.
  // Some Baileys/WhatsApp LID and multi-device events can omit/alter fromMe.
  const botIds = [
    sock?.user?.id,
    sock?.user?.lid,
    sock?.user?.phoneNumber,
    sock?.user?.jid,
    config.OWNER_NUMBER,
    normalizeJid(config.OWNER_NUMBER)
  ].filter(Boolean).map(String);

  const isSameBotIdentity = (value) => {
    if (!value) return false;
    const v = String(value);
    const vb = baseNumber(v);
    return botIds.some(id => id === v || baseNumber(id) === vb);
  };

  const isSelfMessage = Boolean(
    msg.key?.fromMe === true ||
    isSameBotIdentity(msg.key?.participant) ||
    isSameBotIdentity(msg.key?.participantPn) ||
    isSameBotIdentity(msg.key?.senderPn) ||
    (!isGroup(msg.key?.remoteJid) && isSameBotIdentity(msg.key?.remoteJid))
  );

  const jid = msg.key.remoteJid;
  if (!jid || jid === "status@broadcast") return;

  // No single-group lock: the paired WhatsApp account can use its commands
  // in every group where the bot account is a member. Nothing is triggered
  // merely by pairing; command handling happens only after a command message.
  // In LID-addressed groups, participant can be a @lid JID while
  // participantPn contains the normal phone-number JID.
  const sender = msg.key.participant || msg.key.participantPn || jid;
  const senderPn = msg.key.participantPn || msg.key.participant || jid;
  const text = getText(msg).trim();

  // ANTI-STICKER: delete stickers immediately in enabled groups.
  // Group admins/owner are exempt and may always send stickers.
  if (!isSelfMessage && isGroup(jid) && isAntiStickerEnabledForGroup(jid)) {
    const unwrapped = unwrapMessage(msg.message);
    if (unwrapped?.stickerMessage) {
      try {
        const senderIsAdmin = await requireAdmin(sock, jid, sender, senderPn);
        if (!senderIsAdmin) {
          let botAdmin = await isBotAdmin(sock, jid);
          if (!botAdmin) {
            await new Promise(r => setTimeout(r, 500));
            botAdmin = await isBotAdmin(sock, jid);
          }
          if (botAdmin) {
            await sock.sendMessage(jid, { delete: msg.key });

            // After 5 non-admin stickers, lock this group so only admins can send messages.
            const threshold = Math.max(1, Number(settings.antiStickerLockThreshold) || 5);
            const count = Number(settings.antiStickerCounts?.[jid] || 0) + 1;
            settings.antiStickerCounts[jid] = count;

            if (count >= threshold && settings.antiStickerLockedGroups?.[jid] !== true) {
              await sock.groupSettingUpdate(jid, "announcement");
              settings.antiStickerLockedGroups[jid] = true;
              saveSettings();

              // Send the warning sticker only once when the automatic lock happens.
              const stickerPath = path.join(__dirname, "warning_sticker.webp");
              if (fs.existsSync(stickerPath)) {
                await sock.sendMessage(jid, { sticker: fs.readFileSync(stickerPath) });
              } else {
                await sock.sendMessage(jid, { text: "*⚠️ আরে খানকির ছেলে তুই নাকি আবার আমার গ্রূপে sticker মারবি। তোর মা কে চুদি*" });
              }
            } else {
              saveSettings();
            }
          }
        }
      } catch (e) {
        logger.error({ err: e, jid, sender, senderPn }, "anti-sticker delete/lock failed");
      }
      return;
    }
  }

  // IMPORTANT: WhatsApp Story/Status mentions are often protocol messages
  // with no normal text/caption. Do NOT return early on an empty text before
  // checking anti-status, otherwise .antistatus appears ON but never reacts.
  const statusMention = !isSelfMessage && isGroup(jid) && isAntiStatusEnabledForGroup(jid) && isStatusMentionMessage(msg);

  // Cache only incoming messages for anti-delete; self messages are commands/replies.
  if (!isSelfMessage) rememberMessage(msg);


  // ANTI-STATUS / STORY MENTION:
  // Enabled per-group. Admins/owner are exempt. Every non-admin offender gets
  // three warnings; on the third violation the message is deleted and, when
  // kick mode is ON, the member is removed from the group.
  if (statusMention) {
    try {
      const senderIsAdmin = await requireAdmin(sock, jid, sender, senderPn);
      if (senderIsAdmin) return;

      if (!(await isBotAdmin(sock, jid))) {
        await sendTextSafe(sock, jid, "⚠️ ANTI-STATUS ON আছে, কিন্তু BOSS X admin না থাকায় Story/Status Mention delete করা যাচ্ছে না।");
        return;
      }

      const previous = getAntiStatusWarningCount(jid, sender);
      const warning = Math.min(previous + 1, 3);
      const deleted = await deleteMessage(sock, jid, msg.key);
      if (!deleted) return;

      const member = `@${baseNumber(sender)}`;
      if (warning === 1) {
        await sendTextSafe(sock, jid,
`🛡️ *ANTI STATUS WARNING 1/3*
👤 *Member:* ${member}
🚫 *দয়া করে কেউ 𝐆𝐫𝐨𝐮𝐩 এ 𝐒𝐭𝐨𝐫𝐲/𝐒𝐭𝐚𝐭𝐮𝐬 𝐌𝐞𝐧𝐭𝐢𝐨𝐧 দিবেন না।❌ ধন্যবাদ🥲*
🗑️ *আপনার Story/Status delete করে দেওয়া হয়েছে।*
⚠️ *এটি আপনার প্রথম warning।*
🙏 *অনুগ্রহ করে এই গ্রুপে আবার Story দেবেন না।*`, { mentions: [sender] });
      } else if (warning === 2) {
        await sendTextSafe(sock, jid,
`🛡️ *ANTI STATUS WARNING 2/3*
👤 *Member:* ${member}
🚫 *দয়া করে কেউ 𝐆𝐫𝐨𝐮𝐩 এ 𝐒𝐭𝐨𝐫𝐲/𝐒𝐭𝐚𝐭𝐮𝐬 𝐌𝐞𝐧𝐭𝐢𝐨𝐧 দিবেন না।❌ ধন্যবাদ🙄*
*প্রথমবার বলার পরেও আবার 𝐒𝐭𝐨𝐫𝐲/𝐒𝐭𝐚𝐭𝐮𝐬 𝐌𝐞𝐧𝐭𝐢𝐨𝐧 করছো।*
🗑️ *আপনার Story/Status delete করে দেওয়া হয়েছে।*
⚠️ *এটি আপনার দ্বিতীয় warning।*
🙏 *অনুগ্রহ করে এই গ্রুপে আবার Story দেবেন না।*`, { mentions: [sender] });
      } else {
        const kickOn = isAntiStatusKickEnabledForGroup(jid);
        await sendTextSafe(sock, jid,
`🚨 *ANTI STATUS WARNING 3/3*
👤 *Member:* ${member}
😤 *দিনে কতবার Story দেন?*
*এতবার বলার পরেও Story দিচ্ছেন!*
🚫 *দয়া করে কেউ 𝐆𝐫𝐨𝐮𝐩 এ 𝐒𝐭𝐨𝐫𝐲/𝐒𝐭𝐚𝐭𝐮𝐬 𝐌𝐞𝐧𝐭𝐢𝐨𝐧 দিবেন না।❌ ধন্যবাদ😡*
🗑️ *আপনার Story/Status delete করে দেওয়া হয়েছে।*
⚠️ *এটি আপনার FINAL WARNING।*
👢 *Kick এখন ${kickOn ? "ON" : "OFF"} আছে।*
${kickOn ? "🚪 *৩টি warning পূর্ণ হওয়ায় আপনাকে group থেকে remove করা হচ্ছে।*" : `💡 *Kick ON করার জন্য:*\n${getBotPrefix()}antistatus kick on`}`, { mentions: [sender] });

        if (kickOn) {
          try {
            await removeParticipantRobust(sock, jid, sender);
            setAntiStatusWarningCount(jid, sender, 0);
          } catch (kickErr) {
            logger.error({ err: kickErr, jid, sender }, "anti-status kick failed");
          }
        } else {
          setAntiStatusWarningCount(jid, sender, 3);
        }
        return;
      }
      setAntiStatusWarningCount(jid, sender, warning);
      return;
    } catch (e) {
      logger.error({ err: e, jid, sender, senderPn }, "anti-status handler failed");
      return;
    }
  }

  // Status mentions have now been handled. Other non-text messages are not commands.
  if (!text) return;

  // ANTI-MENTION: delete messages that contain @mentions in groups.
  // Admins and owner are exempt. Bot must be a group admin to delete.
  if (!isSelfMessage && settings.antimention && isGroup(jid)) {
    try {
      const ctx = getContextInfo(msg);
      const mentioned = Array.isArray(ctx?.mentionedJid) ? ctx.mentionedJid.filter(Boolean) : [];
      const hasGroupMention = Boolean(
        mentioned.length ||
        unwrapMessage(msg.message)?.groupStatusMentionMessage ||
        unwrapMessage(msg.message)?.groupMentionedMessage
      );
      if (hasGroupMention) {
        const senderIsAdmin = await requireAdmin(sock, jid, sender, senderPn);
        if (!senderIsAdmin) {
          if (!(await isBotAdmin(sock, jid))) {
            await sock.sendMessage(jid, { text: "⚠️ ANTI-MENTION ON আছে, কিন্তু BOSS X admin না থাকায় mention message delete করা যাচ্ছে না।" });
            return;
          }
          const deleted = await deleteMessage(sock, jid, msg.key);
          if (deleted) {
            await sendOwnerPhotoReply(sock, jid, `🚫 ANTI-MENTION\n@${baseNumber(sender)}-এর mention message delete করা হয়েছে।`, { mentions: [sender] });
          }
          return;
        }
      }
    } catch (e) {
      logger.error({ err: e, sender, senderPn }, "anti-mention handler failed");
    }
  }

  // ANTI-LINK: run before command handling so a link is moderated immediately.
  // Admins and owner are exempt. Bot MUST be admin to delete/kick.
  if (!isSelfMessage && isAntiLinkEnabledForGroup(jid) && containsLinkInMessage(msg)) {
    try {
      const senderIsAdmin = await requireAdmin(sock, jid, sender, senderPn);
      if (!senderIsAdmin) {
        if (!(await isBotAdmin(sock, jid))) {
          await new Promise(r => setTimeout(r, 300));
          if (!(await isBotAdmin(sock, jid))) {
            await sock.sendMessage(jid, {
              text: "⚠️ ANTI-LINK ON আছে, কিন্তু BOSS X-এর admin status পাওয়া যাচ্ছে না। Group info refresh করে আবার চেষ্টা করুন।"
            });
            return;
          }
        }

        const deleted = await deleteMessage(sock, jid, msg.key);

        // Anti-link: delete the offending message and immediately remove
        // the sender from this group. Admins/owner are exempt above.
        let kicked = false;
        let kickError = null;
        try {
          await removeParticipantRobust(sock, jid, sender);
          kicked = true;
        } catch (err) {
          kickError = err;
          logger.error({ err, jid, sender }, "anti-link kick failed");
        }

        await sock.sendMessage(jid, {
          text: kicked
            ? `🚫 ANTI-LINK\n@${baseNumber(sender)}-Link মারলি তোর মা ভাজবে বেগুনের চপ তোর মায়ের গুদে গব গব গব কেমন দিলাম বলো Public 🫵😅`
            : deleted
              ? `🚫 ANTI-LINK\n@${baseNumber(sender)}-এর link message delete করা হয়েছে, কিন্তু তাকে remove করা যায়নি। Bot admin status ও target participant check করুন।`
              : `🚫 ANTI-LINK\n@${baseNumber(sender)} link পাঠাতে পারবে না; message delete/kick সম্পন্ন হয়নি।`,
          mentions: [sender]
        });
      }
    } catch (e) {
      logger.error({ err: e, sender, senderPn }, "anti-link handler failed");
    }
    return;
  }

  // Managed anti-bot list (never apply to the paired number itself)
  if (!isSelfMessage && settings.antibot && settings.botJids.some(j => baseNumber(j) === baseNumber(sender))) {
    try { await deleteMessage(sock, jid, msg.key); } catch {}
    return;
  }

  // Accept both .ping and ping.
  if (isSelfMessage) {
    console.log(`🤖 SELF COMMAND: ${text}`);
  } else {
    console.log(`📩 MESSAGE: ${text}`);
  }

  // COMMAND MODE:
  // PRIVATE = only the WhatsApp account that is currently paired may run
  // commands. `fromMe` is the reliable Baileys signal for that paired account,
  // so the same paired number can issue commands from every group it belongs to.
  // PUBLIC = normal commands are available to everyone.
  // Normalize invisible/unusual Unicode characters so `.menu` is recognized
  // reliably from WhatsApp mobile clients.
  const raw = String(text || "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
  const mode = getBotMode();

  // Commands must start with the currently configured prefix.
  // The prefix can be changed by the paired/owner account with .setprefix.
  const prefix = getBotPrefix();
  // BASIC commands ping/menu/help also accept bare form for the paired account,
  // matching the documented self-command behavior. All other commands still
  // require the currently configured prefix.
  let commandText = "";
  if (raw.startsWith(prefix)) {
    commandText = raw.slice(prefix.length).trim();
  } else if (isSelfMessage && /^(ping|menu|help)(?:\s+.*)?$/i.test(raw)) {
    commandText = raw;
  } else {
    return;
  }
  if (!commandText) return;
  const commandMatch = commandText.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  const command = (commandMatch?.[1] || "").toLowerCase();
  const argsRaw = commandMatch?.[2] || "";
  const args = argsRaw ? argsRaw.trim().split(/\s+/) : [];

  // Exact-match commands: these commands must not run when extra text is
  // appended. Example: .menu works, but .menu hello does not.
  const noArgCommands = new Set(["ping", "menu", "help", "owner"]);
  if (noArgCommands.has(command) && argsRaw.trim()) return;
  const canUsePrivateMode =
    isSelfMessage ||
    isSameBotIdentity(sender) ||
    isSameBotIdentity(senderPn) ||
    isOwner(sender) ||
    isOwner(senderPn) ||
    isSudo(sender, senderPn);

  // BASIC self commands must always reach the dispatcher when they come
  // from the paired WhatsApp account. This is intentionally limited to
  // self/owner/sudo identities and does not make `.menu` public.
  if (command === "menu" || command === "help") {
    if (!canUsePrivateMode) {
      console.log(`⛔ MENU BLOCKED: ${command} from ${sender}`);
      return;
    }
    const menuText =
`╭─「 BOSS X BOT 」╮
│ 👨‍💻 Developer: Mr bikramhacker
│ 🤖 Account: ${getBotAccountName(sock)}
│ 👑 ${config.OWNER_NAME}
│
│ 🧰 BASIC
│ 🏓 ${getBotPrefix()}ping
│ 📋 ${getBotPrefix()}menu
│ 👑 ${getBotPrefix()}owner
│
│ 🛡️ SECURITY
│ 📞 ${getBotPrefix()}anticall on/off
│ 🤖 ${getBotPrefix()}antibot on/off
│ ♻️ ${getBotPrefix()}antidelete on/off
│ 🧹 ${getBotPrefix()}anticlean on/off
│ 👮 ${getBotPrefix()}antiadmin on/off
│ 🧹 ${getBotPrefix()}antisticker on/off
│ 🏷️ ${getBotPrefix()}antimention on/off
│ 🚨 ${getBotPrefix()}antistatus on/off
│ 👢 ${getBotPrefix()}antistatus kick on/off
│ 🔗 ${getBotPrefix()}antilink on/off
│ 🤖 ${getBotPrefix()}botadd <number>
│ 🗑️ ${getBotPrefix()}botdel <number>
│ 👢 ${getBotPrefix()}kick @user / reply ${getBotPrefix()}kick
│ 💥 ${getBotPrefix()}kickall
│ 📢 ${getBotPrefix()}htag
│ 🏷️ ${getBotPrefix()}tagall
│ 🏷️ ${getBotPrefix()}totag (reply)
│ 👁️ ${getBotPrefix()}lol (reply to photo)
│ 🗑️ ${getBotPrefix()}de (reply to message)
│
│ 👥 GROUP
│ 🔐 ${getBotPrefix()}setsudo <number> / reply
│ 🗑️ ${getBotPrefix()}dlsudo <number> / reply
│ ✍️ ${getBotPrefix()}setwelcome <message>
│ ✍️ ${getBotPrefix()}setgoodbye <message>
╰──────────────────╯`;
    try {
      await sendTextSafe(sock, jid, menuText);
    } catch (e) {
      logger.error({ err: e, jid, sender }, "menu send failed");
      try {
        await sock.sendMessage(jid, { text: menuText });
      } catch (fallbackError) {
        logger.error({ err: fallbackError, jid }, "menu fallback send failed");
      }
    }
    return;
  }

  if (mode === "private" && !canUsePrivateMode) {
    console.log(`⛔ COMMAND BLOCKED: ${command} from ${sender}`);
    return;
  }
  const isAdmin = adminCommands.has(command);

  if (isAdmin && !isSelfMessage && !(await requireAdmin(sock, jid, sender, senderPn))) {
    await sock.sendMessage(jid, { text: "❌ এই command শুধু group admin/owner ব্যবহার করতে পারবেন।" });
    return;
  }

  try {
    if (command === "setsudo" || command === "dlsudo") {
      if (!isSelfMessage && !isOwner(sender) && !isOwner(senderPn)) {
        await sendBotReply(sock, jid, `❌ ${getBotPrefix()}${command} শুধু bot owner/paired account ব্যবহার করতে পারবেন।`);
        return;
      }
      const quoted = getQuotedMessage(msg);
      const quotedUser = quoted?.key?.participant || quoted?.key?.participantPn || "";
      const targetInput = args[0] || quotedUser;
      const target = normalizeJid(targetInput);
      if (!target) {
        await sendBotReply(sock, jid, `Usage: ${getBotPrefix()}setsudo <number>
অথবা ওই user-এর message-এ reply করে ${getBotPrefix()}setsudo

Remove: ${getBotPrefix()}dlsudo <number> অথবা reply করে ${getBotPrefix()}dlsudo`);
      } else if (baseNumber(target) === baseNumber(sock.user?.id || "") || isOwner(target)) {
        await sendBotReply(sock, jid, "❌ Bot/Owner-কে sudo list-এ পরিবর্তন করা যাবে না।");
      } else if (command === "setsudo") {
        const added = addSudo(target);
        await sendBotReply(sock, jid, `🔐 SUDO ADDED ✅\n👤 +${baseNumber(added)}`);
      } else {
        const result = removeSudo(target);
        await sendBotReply(sock, jid, result.removed ? `🗑️ SUDO REMOVED ✅\n👤 -${baseNumber(result.jid)}` : `ℹ️ এই number sudo list-এ ছিল না।\n👤 ${baseNumber(result.jid)}`);
      }
    } else if (command === "ping") {
      await sendOwnerPhotoReply(sock, jid, `⚡aru999+ BXSPEED 00.999
👑 ${config.OWNER_NAME}`);
    } else if (command === "menu" || command === "help") {
      // Handled above before the mode/admin gate.
      return;
    } else if (command === "owner") {
      await sendOwnerPhotoReply(sock, jid, `🤖 Bot Account: ${getBotAccountName(sock)}\n👑 Owner: ${config.OWNER_NAME}\n📱 ${config.OWNER_NUMBER}`);
    } else if (command === "channel") {
      await sendOwnerPhotoReply(sock, jid, `📢 CHANNEL
👑 ${config.OWNER_NAME}

নিচের View channel button-এ চাপুন।`, {
        templateButtons: config.CHANNEL_URL ? [{
          index: 1,
          urlButton: { displayText: "📢 View channel", url: config.CHANNEL_URL }
        }] : []
      });
    } else if (command === "setprefix" || command === "prefix") {
      if (!isSelfMessage && !(isOwner(sender) || isOwner(senderPn))) {
        await sendBotReply(sock, jid, "❌ শুধু bot-এর paired/owner account prefix পরিবর্তন করতে পারবে।");
        return;
      }
      const requestedPrefix = argsRaw.trim();
      if (!requestedPrefix || /\s/u.test(requestedPrefix) || Array.from(requestedPrefix).length > 20) {
        await sendBotReply(sock, jid,
          `⚙️ Current prefix: ${getBotPrefix()}\n\nUsage: ${getBotPrefix()}setprefix !\nExamples: ${getBotPrefix()}setprefix # | ${getBotPrefix()}setprefix 🔥 | ${getBotPrefix()}setprefix 🚀`);
        return;
      }
      const selected = setBotPrefix(requestedPrefix);
      if (!selected) {
        await sendBotReply(sock, jid, "❌ Prefix 1–20 Unicode characters হতে হবে এবং space/line break থাকতে পারবে না। A-Z, সংখ্যা, symbols ও emoji ব্যবহার করা যাবে।");
        return;
      }
      await sendBotReply(sock, jid, `✅ Prefix changed successfully!\n🔧 New prefix: ${selected}`);
    } else if (command === "mode") {
      const requested = args[0]?.toLowerCase();
      if (!["private", "public"].includes(requested)) {
        await sendBotReply(sock, jid, `🔐 BOT MODE: ${getBotMode().toUpperCase()}\n\nUsage:\n${getBotPrefix()}mode private\n${getBotPrefix()}mode public`);
      } else {
        const selected = setBotMode(requested);
        await sendBotReply(sock, jid, selected === "private"
          ? "🔐 PRIVATE MODE ON\nশুধু Owner/paired number bot commands ব্যবহার করতে পারবে।"
          : "🌐 PUBLIC MODE ON\nসাধারণ bot commands সবাই ব্যবহার করতে পারবে। Admin commands এখনও group admin/owner-এর জন্য।");
      }
    } else if (command === "settings") {
      if (!args.length) {
        await sendBotReply(sock, jid, settingsText(jid));
      } else {
        const feature = args[0].toLowerCase();
        const value = args[1]?.toLowerCase();
        if (["antilink", "anti-link", "antiadmin", "antisticker"].includes(feature)) {
          if (!isGroup(jid)) {
            await sendBotReply(sock, jid, `❌ ${feature} শুধু group-এ ব্যবহার করা যাবে।`);
          } else if (!["on", "off"].includes(value)) {
            await sendBotReply(sock, jid, `Usage: ${getBotPrefix()}settings ${feature} on/off`);
          } else {
            const enabled = value === "on";
            if (feature === "antilink" || feature === "anti-link") setAntiLinkForGroup(jid, enabled);
            else if (feature === "antiadmin") setAntiAdminForGroup(jid, enabled);
            else setAntiStickerForGroup(jid, enabled);
            await sendBotReply(sock, jid, `⚙️ ${feature.toUpperCase()} এই group-এ ${enabled ? "ON ✅" : "OFF ❌"}`);
          }
        } else {
          const changed = changeSetting(feature, value);
          if (!changed) await sendBotReply(sock, jid, `Usage: ${getBotPrefix()}settings <feature> on/off`);
          else await sendBotReply(sock, jid, `⚙️ ${changed} ${settings[changed] ? "ON ✅" : "OFF ❌"}`);
        }
      }
    } else if (command === "antistatus") {
      if (!isGroup(jid)) {
        await sendBotReply(sock, jid, "❌ antistatus শুধু group-এ ব্যবহার করা যাবে।");
      } else {
        const sub = args[0]?.toLowerCase();
        const value = args[1]?.toLowerCase();
        if (sub === "kick") {
          if (!["on", "off"].includes(value)) {
            await sendBotReply(sock, jid, `Usage: ${getBotPrefix()}antistatus kick on/off`);
          } else {
            setAntiStatusKickForGroup(jid, value === "on");
            await sendBotReply(sock, jid, `👢 ANTI-STATUS KICK এই group-এ ${value === "on" ? "ON ✅" : "OFF ❌"}`);
          }
        } else if (["on", "off"].includes(sub)) {
          setAntiStatusForGroup(jid, sub === "on");
          if (sub === "on") setAntiStatusKickForGroup(jid, true);
          await sendBotReply(sock, jid, `🚨 ANTI-STATUS/STORY এই group-এ ${sub === "on" ? "ON ✅ (3 warnings-এর পর AUTO KICK)" : "OFF ❌"}`);
        } else {
          await sendBotReply(sock, jid,
`Usage:
${getBotPrefix()}antistatus on/off
${getBotPrefix()}antistatus kick on/off`);
        }
      }
    } else if (["antiadmin", "antisticker"].includes(command)) {
      if (!isGroup(jid)) {
        await sendBotReply(sock, jid, `❌ ${command} শুধু group-এ ব্যবহার করা যাবে।`);
      } else {
        const value = args[0]?.toLowerCase();
        if (!["on", "off"].includes(value)) {
          await sendBotReply(sock, jid, `Usage: ${getBotPrefix()}${command} on/off`);
        } else if (command === "antiadmin") {
          setAntiAdminForGroup(jid, value === "on");
          await sendBotReply(sock, jid, `🛡️ ANTI-ADMIN এই group-এ ${value === "on" ? "ON ✅" : "OFF ❌"}`);
        } else {
          setAntiStickerForGroup(jid, value === "on");
          await sendBotReply(sock, jid, `🧹 ANTI-STICKER এই group-এ ${value === "on" ? "ON ✅" : "OFF ❌"}`);
        }
      }
    } else if (["anticall","antibot","antidelete","anticlean","antimention","antitag","antilink"].includes(command) && !(command === "antilink" && args[0]?.toLowerCase() === "kick")) {
      const value = args[0]?.toLowerCase();
      if (!["on", "off"].includes(value)) {
        await sendBotReply(sock, jid, `Usage: .${command} on/off`);
      } else if (command === "antilink") {
        if (!isGroup(jid)) {
          await sendBotReply(sock, jid, `❌ ${command} শুধু group-এ ব্যবহার করা যাবে।`);
          return;
        }
        const enabled = value === "on";
        setAntiLinkForGroup(jid, enabled);
        await sendBotReply(sock, jid, `🔗 ANTI-LINK এই group-এ ${enabled ? "ON ✅ (DELETE + KICK)" : "OFF ❌"}`);
      } else {
        const changed = changeSetting(command, value);
        if (!changed) await sendBotReply(sock, jid, `Usage: .${command} on/off`);
        else await sendBotReply(sock, jid, `⚙️ ${command.toUpperCase()} ${settings[changed] ? "ON ✅" : "OFF ❌"}`);
      }
    } else if (command === "botadd") {
      const rawNumber = String(args[0] || "").replace(/\D/g, "");
      const botJid = normalizeJid(rawNumber);
      if (!botJid || rawNumber.length < 7 || rawNumber.length > 15) await sendBotReply(sock, jid, `Usage: ${getBotPrefix()}botadd 919XXXXXXXXX`);
      else {
        if (!settings.botJids.some(j => baseNumber(j) === baseNumber(botJid))) settings.botJids.push(botJid);
        saveSettings();
        await sendBotReply(sock, jid, `🤖 Added: ${botJid}`);
      }
    } else if (command === "botdel") {
      const rawNumber = String(args[0] || "").replace(/\D/g, "");
      const botJid = normalizeJid(rawNumber);
      if (!botJid || rawNumber.length < 7 || rawNumber.length > 15) {
        await sendBotReply(sock, jid, `Usage: ${getBotPrefix()}botdel 919XXXXXXXXX`);
      } else {
        const before = settings.botJids.length;
        settings.botJids = settings.botJids.filter(j => baseNumber(j) !== baseNumber(botJid));
        saveSettings();
        await sendBotReply(sock, jid, before !== settings.botJids.length ? `🤖 Removed: ${botJid}` : `ℹ️ ${botJid} bot list-এ ছিল না।`);
      }
    } else if (["de", "del", "delete"].includes(command)) {
      const quoted = getQuotedMessage(msg);
      if (!quoted?.key?.id) {
        await sendBotReply(sock, jid, `🗑️ যে message delete করতে চান, সেটাতে reply করে ${getBotPrefix()}de দিন।`);
      } else {
        try {
          // Delete the replied/quoted message. For group chats this requires
          // the bot to be an admin when deleting another member's message.
          await sock.sendMessage(jid, { delete: quoted.key });
          await sendBotReply(sock, jid, "🗑️ Message deleted successfully ✅");
        } catch (e) {
          await sendBotReply(sock, jid, `❌ Message delete করা যায়নি: ${e.message || "Bot-কে admin করুন বা message-এ reply করে চেষ্টা করুন।"}`);
        }
      }
    } else if (command === "lol") {
      const quoted = getQuotedMessage(msg);
      if (!quoted) {
        await sendBotReply(sock, jid, `🖼️ আগে একটি view-once/photo-তে reply করে ${getBotPrefix()}lol দিন।`);
      } else {
        try {
          // .lol converts a quoted view-once image into a normal/full image
          // and sends it back only to the same chat where .lol was used; never to OWNER_NUMBER.
          const qm = unwrapMessage(quoted.message);
          if (!qm.imageMessage) throw new Error(`${getBotPrefix()}lol শুধু photo/image message-এ কাজ করে।`);
          const buffer = await downloadMediaMessage(
            quoted, "buffer", {}, { logger: P({ level: "silent" }) }
          );
          await sock.sendMessage(jid, {
            image: buffer,
            caption: qm.imageMessage.caption || `🖼️ Full photo • BOSS X ${getBotPrefix()}lol`
          });
          await sendBotReply(sock, jid, "🖼️ View-once photo → Full photo করা হয়েছে এবং এই chat-এই পাঠানো হয়েছে ✅");
        } catch (e) {
          await sendBotReply(sock, jid, `❌ ${getBotPrefix()}lol failed: ${e.message || "photo পাওয়া যায়নি"}`);
        }
      }
    } else if (command === "kick") {
      if (!isGroup(jid)) {
        await sendBotReply(sock, jid, "❌ এই command শুধু group-এ ব্যবহার করা যাবে।");
      } else if (!(await isBotAdmin(sock, jid))) {
        await sendBotReply(sock, jid, "❌ Kick করতে bot-কে admin করতে হবে।");
      } else {
        const ctx = getContextInfo(msg);
        const quoted = ctx?.participant || null;
        const mentioned = Array.isArray(ctx?.mentionedJid) ? ctx.mentionedJid[0] : null;
        const rawTarget = mentioned || quoted || args[0];
        const target = normalizeJid(rawTarget);
        const participant = target ? await getGroupParticipant(sock, jid, target) : null;
        const targetJid = participant?.id || participant?.phoneNumber || participant?.lid || target;
        if (!targetJid) {
          await sendBotReply(sock, jid, `Usage: ${getBotPrefix()}kick @user অথবা কারও message-এ reply করে ${getBotPrefix()}kick`);
        } else if (participantIsAdmin(participant)) {
          await sendBotReply(sock, jid, "❌ Admin-কে kick করা যাবে না।");
        } else if (isOwner(targetJid) || isOwner(participant?.phoneNumber) || baseNumber(targetJid) === baseNumber(sock.user?.id)) {
          await sendBotReply(sock, jid, "❌ Owner/bot-কে kick করা যাবে না।");
        } else {
          try {
            const removal = await removeParticipantRobust(sock, jid, targetJid);
            const mentionJid = removal.target || targetJid;
            await sendBotReply(sock, jid, `🥾 @${baseNumber(mentionJid)} group থেকে kick করা হয়েছে।`, { mentions: [mentionJid] });
          } catch (e) {
            logger.error({ err: e, jid, rawTarget, targetJid }, "manual kick failed");
            await sendBotReply(sock, jid, `❌ Kick করা যায়নি: ${e.message || "WhatsApp request rejected"}`);
          }
        }
      }
    } else if (["htag", "tagall", "totag"].includes(command)) {
      if (!isGroup(jid)) {
        await sendBotReply(sock, jid, "❌ এই command শুধু group-এ ব্যবহার করা যাবে।");
      } else {
        const metadata = await sock.groupMetadata(jid);
        const participants = (metadata.participants || []).map(p => p.id).filter(Boolean);
        if (!participants.length) return;
        const mentions = participants;
        let body = "📢 TAG ALL\n\n" + mentions.map(p => `@${baseNumber(p)}`).join(" ");
        if (command === "htag") body = "🔔 H-TAG\n\n" + mentions.map(p => `@${baseNumber(p)}`).join(" ");
        if (command === "totag") {
          const ctx = getContextInfo(msg);
          if (!ctx?.quotedMessage) {
            await sendBotReply(sock, jid, `❌ আগে কোনো message reply/quote করে ${getBotPrefix()}totag দিন।`);
            return;
          }
          const quoted = { key: { remoteJid: jid, id: ctx.stanzaId, participant: ctx.participant }, message: ctx.quotedMessage };
          const quotedText = getText(quoted);
          body = (quotedText ? `💬 ${quotedText}\n\n` : "💬 Message\n\n") + mentions.map(p => `@${baseNumber(p)}`).join(" ");
          await sendBotReply(sock, jid, body, { mentions });
          return;
        }
        await sendBotReply(sock, jid, body, { mentions });
      }
    } else if (command === "kickall") {
      if (!isGroup(jid)) {
        await sendBotReply(sock, jid, "❌ এই command শুধু group-এ ব্যবহার করা যাবে।");
      } else if (!(await isBotAdmin(sock, jid))) {
        await sendBotReply(sock, jid, "❌ Kickall করতে bot-কে admin করতে হবে।");
      } else {
        try {
          const metadata = await sock.groupMetadata(jid);
          const targets = metadata.participants
            .filter(p => !participantIsAdmin(p) && !participantMatchesBot(sock, p) && !isOwner(p.id))
            .map(p => p.id);
          if (!targets.length) {
            await sendBotReply(sock, jid, "ℹ️ Kick করার মতো কোনো non-admin member নেই।");
          } else {
            // Send the whole target list in one participant-update request so Kickall
            // starts immediately instead of waiting 5 members at a time.
            let result;
            try {
              result = await sock.groupParticipantsUpdate(jid, targets, "remove");
            } catch (bulkErr) {
              // If WhatsApp/Baileys rejects an oversized bulk request, fall back to
              // small concurrent batches rather than stopping the whole command.
              logger.warn({ err: bulkErr, jid, count: targets.length }, "bulk kickall failed; falling back to concurrent batches");
              const batches = [];
              for (let i = 0; i < targets.length; i += 5) batches.push(targets.slice(i, i + 5));
              result = (await Promise.allSettled(
                batches.map(batch => sock.groupParticipantsUpdate(jid, batch, "remove"))
              )).flatMap(r => r.status === "fulfilled" && Array.isArray(r.value) ? r.value : []);
            }
            const kicked = Array.isArray(result)
              ? result.filter(r => ["200", "207", 200, 207].includes(r?.status)).length
              : targets.length;
            await sendBotReply(sock, jid, `🥾 KICKALL COMPLETE ⚡
👤 ${kicked} জন member remove হয়েছে/হওয়ার সফল response এসেছে।
📋 মোট target: ${targets.length}`);
          }
        } catch (e) {
          await sendBotReply(sock, jid, `❌ Kickall failed: ${e.message || "unknown error"}`);
        }
      }
    } else if (command === "linkreset" || command === "resetlink") {
      if (!isGroup(jid)) {
        await sendBotReply(sock, jid, "❌ এই command শুধু group-এ ব্যবহার করা যাবে।");
      } else if (!(await isBotAdmin(sock, jid))) {
        await sendBotReply(sock, jid, "❌ Link reset করতে bot-কে admin করতে হবে।");
      } else {
        try {
          await sock.groupRevokeInvite(jid);
          const code = await sock.groupInviteCode(jid);
          await sendBotReply(sock, jid, `♻️ GROUP LINK RESET
নতুন link:
https://chat.whatsapp.com/${code}`);
        } catch (e) {
          await sendBotReply(sock, jid, `❌ Group link reset করা যায়নি: ${e.message || "unknown error"}`);
        }
      }
    } else if (command === "link" || command === "grouplink") {
      if (!isGroup(jid)) {
        await sendBotReply(sock, jid, "❌ এই command শুধু group-এ ব্যবহার করা যাবে।");
      } else if (!(await isBotAdmin(sock, jid))) {
        await sendBotReply(sock, jid, "❌ Group link দিতে bot-কে admin করতে হবে।");
      } else {
        try {
          const code = await sock.groupInviteCode(jid);
          if (!code) throw new Error("Invite code পাওয়া যায়নি।");
          await sendBotReply(sock, jid, `🔗 GROUP LINK\nhttps://chat.whatsapp.com/${code}`);
        } catch (e) {
          await sendBotReply(sock, jid, `❌ Group link পাওয়া যায়নি: ${e.message || "unknown error"}`);
        }
      }
    } else if (command === "group" || command === "open" || command === "close") {
      if (!isGroup(jid)) {
        await sendBotReply(sock, jid, "❌ এই command শুধু group-এ ব্যবহার করা যাবে।");
      } else {
        let action = command;
        if (command === "group") action = args[0]?.toLowerCase();
        if (!["open", "close"].includes(action)) {
          await sendBotReply(sock, jid, `Usage: ${getBotPrefix()}group open\n       ${getBotPrefix()}group close`);
        } else if (!(await isBotAdmin(sock, jid))) {
          await sendBotReply(sock, jid, "❌ Group open/close করতে bot-কে admin করতে হবে।");
        } else {
          await sock.groupSettingUpdate(jid, action === "open" ? "not_announcement" : "announcement");
          if (action === "open") {
            // Re-arm the anti-sticker lock counter when the group is opened manually.
            delete settings.antiStickerCounts[jid];
            delete settings.antiStickerLockedGroups[jid];
            saveSettings();
          }
          await sendOwnerCommandCard(
            sock,
            jid,
            action === "open"
              ? "🔓 GROUP OPEN"
              : "🔒 GROUP CLOSE",
            action === "open"
              ? "সবাই এখন message পাঠাতে পারবে।"
              : "এখন শুধু admins message পাঠাতে পারবে।"
          );
        }
      }
    } else if (command === "setwelcome") {
      if (!isGroup(jid)) {
        await sendBotReply(sock, jid, "❌ setwelcome শুধু group-এ ব্যবহার করা যাবে।");
      } else {
        const value = cleanCustomMessage(argsRaw);
        if (!value) {
          await sendBotReply(sock, jid, `Usage: ${getBotPrefix()}setwelcome <message>\n\nCurrent Welcome Message*\n\n${groupSettings.welcomeMessage}\n\n*Tip:* Use @user to mention the new member`
        }, { quoted: msg });
      }
      
      এই group-এর জন্য welcome caption সেট হবে।\nPlaceholders: {user}, {group}, {count}\nReset: ${getBotPrefix()}setwelcome default`);
        } else if (value.toLowerCase() === "default") {
          resetGroupMessage(settings.welcomeGroups, jid);
          setWelcomeEnabledForGroup(jid, true);
          await sendBotReply(sock, jid, "👋 এই group-এর welcome default message চালু হয়েছে ✅");
        } else {
          if (value.length > 4000) {
            await sendBotReply(sock, jid, "❌ Welcome message is too long. Keep it under 4000 characters.");
          } else {
            setGroupMessage(settings.welcomeGroups, jid, value);
            setWelcomeEnabledForGroup(jid, true);
            await sendBotReply(sock, jid, `👋 এই group-এর welcome message saved & enabled ✅\n\n${value}`);
          }
        }
      }
    } else if (command === "setgoodbye") {
      if (!isGroup(jid)) {
        await sendBotReply(sock, jid, "❌ setgoodbye শুধু group-এ ব্যবহার করা যাবে।");
      } else {
        const value = cleanCustomMessage(argsRaw);
        if (!value) {
          await sendBotReply(sock, jid, `Usage: ${getBotPrefix()}setgoodbye <message>\n\nএই group-এর goodbye caption সেট হবে।\nPlaceholders: {user}, {group}, {count}\nReset: ${getBotPrefix()}setgoodbye default`);
        } else if (value.toLowerCase() === "default") {
          resetGroupMessage(settings.goodbyeGroups, jid);
          setGoodbyeEnabledForGroup(jid, true);
          await sendBotReply(sock, jid, "🚪 এই group-এর goodbye default message চালু হয়েছে ✅");
        } else {
          if (value.length > 4000) {
            await sendBotReply(sock, jid, "❌ Goodbye message is too long. Keep it under 4000 characters.");
          } else {
            setGroupMessage(settings.goodbyeGroups, jid, value);
            setGoodbyeEnabledForGroup(jid, true);
            await sendBotReply(sock, jid, `🚪 এই group-এর goodbye message saved & enabled ✅\n\n${value}`);
          }
        }
      }
    } else if (command === "goodnight" || command === "gn") {
      await sendBotReply(sock, jid, "🌙 Good night everyone! Sweet dreams 😴✨");
    } else if (command === "song" || command === "play") {
      if (!settings.song) return void await sendBotReply(sock, jid, "🎵 Song command is OFF.");
      await sendOwnerCommandCard(sock, jid, command === "play" ? "▶️ PLAY" : "🎧 SONG", "⏳ Song খোঁজা হচ্ছে...");
      await sendSong(sock, jid, args.join(" "));
    } else if (command === "gcstory") {
      if (!isGroup(jid)) return void await sendBotReply(sock, jid, `❌ ${getBotPrefix()}gcstory শুধু group-এ ব্যবহার করা যাবে।`);
      const ctx = getContextInfo(msg);
      if (!ctx.quotedMessage) return void await sendBotReply(sock, jid, `❌ আগে একটি photo/video/text/link message reply/quote করে ${getBotPrefix()}gcstory দিন।`);

      const quoted = {
        key: { remoteJid: jid, id: ctx.stanzaId, participant: ctx.participant },
        message: ctx.quotedMessage
      };
      const qm = unwrapMessage(quoted.message);
      let groupStatusMessage;

      if (qm.imageMessage || qm.videoMessage || qm.audioMessage || qm.documentMessage) {
        const buffer = await downloadMediaMessage(
          quoted, "buffer", {}, { logger: P({ level: "silent" }) }
        );

        if (qm.imageMessage) {
          groupStatusMessage = {
            image: buffer,
            caption: qm.imageMessage.caption || ""
          };
        } else if (qm.videoMessage) {
          groupStatusMessage = {
            video: buffer,
            caption: qm.videoMessage.caption || ""
          };
        } else if (qm.audioMessage) {
          groupStatusMessage = {
            audio: buffer,
            mimetype: qm.audioMessage.mimetype || "audio/mpeg"
          };
        } else {
          // WhatsApp group status supports media/text status types; documents
          // are not treated as a normal status. Send the document caption/text
          // when available rather than silently posting it as a chat message.
          const qt = getText(quoted);
          if (!qt) return void await sendBotReply(sock, jid, "❌ এই document-টি Group Status হিসেবে publish করা যায় না। Photo, Video, Text বা Link reply করুন।");
          groupStatusMessage = { text: qt };
        }
      } else {
        const qt = getText(quoted);
        if (!qt) return void await sendBotReply(sock, jid, "❌ Quoted message-এ text/link/photo/video পাওয়া যায়নি।");
        groupStatusMessage = { text: qt };
      }

      // IMPORTANT: publish as WhatsApp Group Status (groupStatusMessageV2),
      // not as status@broadcast. The stock @whiskeysockets/baileys 6.7.24
      // treats the wrapper as an unknown media object and throws
      // "Invalid media type". The group-status-capable fork accepts the
      // groupStatus wrapper and builds the proper V2 envelope.
      await sock.sendMessage(jid, { ...groupStatusMessage, groupStatus: true });
      await sendBotReply(sock, jid, "📖 GROUP STATUS ✅\nReply করা content এই group-এর Group Status-এ publish হয়েছে।");
    }
  } catch (e) {
    logger.error({ err:e, command, jid }, "command failed");
    await sendBotReply(sock, jid, `❌ Command error: ${e.message || "unknown error"}`).catch(() => {});
  }

  // Automatic plain-text replies
  if (isSelfMessage) return;

  const lower = text.toLowerCase();
  if (settings.autoGoodNight && /(^|\s)(good\s*night)(\s|$)/i.test(lower) && !["goodnight","gn"].includes(command)) {
    await sock.sendMessage(jid, { text: "🌙 Good night! Sweet dreams 😴" }).catch(() => {});
  }

}

let startingBot = false;
async function startBot() {
  if (startingBot) return;
  startingBot = true;
  const { state, saveCreds } = await useMultiFileAuthState("./auth_info");

  // Do not depend on fetchLatestBaileysVersion; it can prevent startup when
  // a hosting environment cannot reach the version endpoint.
  // WhatsApp periodically changes the Web client revision. A stale
  // hard-coded revision can cause WebSocket 405 / client_too_old loops.
  let waVersion;
  try {
    const latest = await fetchLatestBaileysVersion();
    if (latest?.version?.length === 3) {
      waVersion = latest.version;
      console.log(`🌐 WhatsApp Web version: ${waVersion.join(".")}`);
    }
  } catch (e) {
    console.warn("⚠️ Could not fetch live WhatsApp Web version; using Baileys default.", e.message);
  }

  const sock = makeWASocket({
    auth: state,
    logger,
    ...(waVersion ? { version: waVersion } : {}),
    browser: Browsers.ubuntu("Chrome"),
    markOnlineOnConnect: true,
    syncFullHistory: false,
    generateHighQualityLinkPreview: true,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    retryRequestDelayMs: 2000
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log("\n===== BOSS X QR CODE =====\n");
      qrcode.generate(qr, { small: true });
      console.log("\n==========================\n");
    }
    if (connection === "connecting") console.log("🔄 Connecting to WhatsApp...");
    if (connection === "open") {
      console.log("====================================");
      console.log("✅ BOSS X BOT CONNECTED SUCCESSFULLY");
      console.log(`🤖 Account: ${getBotAccountName(sock)}`);
      console.log(`👑 Owner: ${config.OWNER_NAME}`);
      console.log(`🔧 PREFIX: ${getBotPrefix()}`);
      console.log(`🔐 BOT MODE: ${getBotMode().toUpperCase()}`);
      console.log("📡 Outgoing message timeout protection: ON");
      console.log("📩 Send from owner number: ping / menu / settings");
      console.log("====================================");
    }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const reconnect = code !== DisconnectReason.loggedOut;
      console.log(`❌ Connection closed. code=${code ?? "unknown"}`);
      startingBot = false;
      if (reconnect) setTimeout(() => startBot().catch(err => console.error("❌ RECONNECT FATAL:", err)), 3000);
      else console.log("🔒 Logged out. Delete auth_info and pair again.");
    }
  });

  // Pairing code for environments where QR is inconvenient.
  if (!state.creds.registered && !pairingAsked) {
    pairingAsked = true;
    let number = process.env.PAIRING_NUMBER;
    if (!number && process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      number = await new Promise(resolve => rl.question("Enter WhatsApp number (country code, digits only): ", resolve));
      rl.close();
    }
    if (number) {
      number = String(number).replace(/\D/g, "");
      try {
        await new Promise(r => setTimeout(r, 2000));
        const code = await sock.requestPairingCode(number);
        console.log(`\n🔐 PAIRING CODE: ${code}\n`);
      } catch (e) {
        console.error("❌ Pairing code error:", e.message);
      }
    }
  }

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    console.log(`📨 messages.upsert: ${type || "unknown"} (${messages?.length || 0})`);
    for (const msg of messages || []) {
      try {
        await handleMessage(sock, msg);
      } catch (e) {
        logger.error({ err:e }, "message handler crashed");
      }
    }
  });

  sock.ev.on("messages.update", async updates => {
    for (const update of updates || []) {
      if (settings.antidelete) await restoreDeleted(sock, update, "♻️ ANTI-DELETE");
      if (settings.anticClean) await restoreDeleted(sock, update, "🧹 ANTI-CLEAN");
    }
  });

  sock.ev.on("call", async calls => {
    if (!settings.anticall) return;
    for (const call of calls || []) {
      try {
        await sock.rejectCall(call.id, call.from);
        await sock.sendMessage(call.from, { text: "🚫 ANTI-CALL: এই bot call গ্রহণ করে না।" });
      } catch (e) { logger.error({ err:e }, "anti-call failed"); }
    }
  });

  sock.ev.on("group-participants.update", async update => {
    const { id, participants, action } = update || {};
    if (!isGroup(id)) return;

    try {
      // Welcome/Goodbye are automatic; there are no welcome/goodbye on/off or
      // welcomegroup commands. setwelcome/setgoodbye only change their text.
      // Baileys normally sends `participants`, but keep a safe fallback for
      // forks/older builds that expose a single `participant` field.
      const rawParticipants = Array.isArray(participants)
        ? participants
        : (update?.participant ? [update.participant] : []);
      const changedParticipants = Array.from(new Set(
        rawParticipants.filter(Boolean).map(String)
      ));

      logger.info({
        id,
        action,
        participants: changedParticipants,
        welcomeEnabled: isWelcomeEnabledForGroup(id),
        goodbyeEnabled: isGoodbyeEnabledForGroup(id)
      }, "group participant update");

      if (action === "add" && changedParticipants.length && isWelcomeEnabledForGroup(id)) {
        await new Promise(r => setTimeout(r, 800));
        const metadata = await getGroupMetadataSafe(sock, id);
        const groupName = metadata?.subject || "this group";
        await sendWelcomeMessage(sock, id, changedParticipants, groupName).catch(err =>
          logger.error({ err, id, participants: changedParticipants }, "welcome message failed")
        );
      } else if (action === "remove" && changedParticipants.length && isGoodbyeEnabledForGroup(id)) {
        await new Promise(r => setTimeout(r, 800));
        const metadata = await getGroupMetadataSafe(sock, id);
        const groupName = metadata?.subject || "this group";
        await sendGoodbyeMessage(sock, id, changedParticipants, groupName).catch(err =>
          logger.error({ err, id, participants: changedParticipants }, "goodbye message failed")
        );
      }

      if ((action === "promote" || action === "demote") && isAntiAdminEnabledForGroup(id)) {
        // ANTI-ADMIN:
        // promote  -> demote the newly promoted member
        // demote   -> remove the member who was just demoted
        // Never act on the configured owner or the bot itself.
        await new Promise(r => setTimeout(r, 1200));

        const metadata = await getGroupMetadataSafe(sock, id);
        if (!metadata) {
          logger.warn({ id }, "anti-admin: group metadata unavailable");
          return;
        }

        const ownerNumber = baseNumber(config.OWNER_NUMBER);
        const botNumbers = new Set([
          baseNumber(sock.user?.id || ""),
          baseNumber(sock.user?.lid || ""),
          baseNumber(sock.user?.phoneNumber || ""),
          baseNumber(sock.user?.jid || ""),
          baseNumber(sock.user?.wid || "")
        ].filter(Boolean));

        const targets = [];
        for (const who of Array.from(new Set(participants || []))) {
          const p = (metadata.participants || []).find(x => participantMatchesJid(x, who));
          const values = Array.from(new Set([
            who, p?.id, p?.phoneNumber, p?.lid, p?.jid
          ].filter(Boolean).map(String)));

          const numbers = values.map(baseNumber).filter(Boolean);
          if (numbers.includes(ownerNumber) || numbers.some(n => botNumbers.has(n))) continue;

          targets.push({ who: String(who), candidates: values });
        }

        if (!targets.length) return;

        if (!(await isBotAdmin(sock, id))) {
          await sendTextSafe(sock, id, `⚠️ ANTI-ADMIN ON আছে, কিন্তু BOSS X admin না থাকায় ${action === "promote" ? "promote করা সদস্যকে demote" : "demote করা সদস্যকে remove"} করা যাচ্ছে না।`);
          return;
        }

        const operation = action === "promote" ? "demote" : "remove";
        let success = 0;
        const mentions = [];

        for (const target of targets) {
          let done = false;
          let lastErr = null;

          // Try every JID form advertised by WhatsApp. This is important for
          // newer groups where id may be a LID while phoneNumber is available.
          for (const candidate of target.candidates) {
            try {
              const result = await sock.groupParticipantsUpdate(id, [candidate], operation);
              const statuses = Array.isArray(result)
                ? result.map(r => String(r?.status ?? ""))
                : [];
              if (!statuses.length || statuses.some(code => ["200", "207"].includes(code))) {
                done = true;
                break;
              }
              lastErr = new Error(`WhatsApp returned status ${statuses.join(",")}`);
            } catch (err) {
              lastErr = err;
            }
          }

          if (done) {
            success++;
            mentions.push(target.who);
          } else {
            logger.error({ id, target: target.who, operation, err: lastErr }, "anti-admin action failed");
          }
        }

        if (success) {
          await sendTextSafe(
            sock,
            id,
            action === "promote"
              ? `🛡️ ANTI-ADMIN\n${success} জনকে admin করা হয়েছিল, তাই সঙ্গে সঙ্গে demote করা হয়েছে।`
              : `🛡️ ANTI-ADMIN\n${success} জনকে admin থেকে demote করা হয়েছিল, তাই group থেকে remove করা হয়েছে।`,
            { mentions }
          );
        }
      }
    } catch (e) { logger.error({ err:e }, "group participant handler failed"); }
  });
}

startBot().catch(err => {
  console.error("❌ FATAL:", err);
  process.exit(1);
});
