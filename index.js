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
  const lines =
