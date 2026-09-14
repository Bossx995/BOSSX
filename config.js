module.exports = {
  PRIVATE_MODE: process.env.PRIVATE_MODE !== "false", // legacy compatibility
  MODE: process.env.BOT_MODE || "private", // private = owner-only, public = members can use normal commands
  OWNER_NAME: process.env.OWNER_NAME || "Mr bikramhacker",
  OWNER_NUMBER: process.env.OWNER_NUMBER || "919123827995",
  CHANNEL_ID: process.env.CHANNEL_ID || "120363412006298804@newsletter",
  CHANNEL_NAME: process.env.CHANNEL_NAME || "BOSS X",
  CHANNEL_URL: process.env.CHANNEL_URL || "https://whatsapp.com/channel/0029VbDqHfKKQuJMRHZzZX11",
  WELCOME_PHOTO: process.env.WELCOME_PHOTO || "welcome.jpg",
  PREFIX: "."
};