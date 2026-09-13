# BOSS X WhatsApp Bot v1.5.13 — Fixed

## Commands

### Basic
- `.menu` / `.help`
- `.ping`
- `.owner`
- `.channel`

### Security
- `.anticall on/off`
- `.antibot on/off`
- `.antidelete on/off`
- `.anticlean on/off`
- `.antiadmin on/off` — per-group; promoted members are immediately demoted, and demoted admins are removed
- `.antisticker on/off` — per-group
- `.antimention on/off`
- `.antilink on/off` — deletes link messages and immediately removes the sender (admins/owner are exempt)

### Group / Admin
- `.kick @user` or reply with `.kick`
- `.kickall`
- `.htag`
- `.tagall`
- `.totag` (reply)
- `.de` / `.del` / `.delete` (reply)
- `.group open`
- `.group close`
- `.open` / `.close`
- `.link` / `.grouplink`
- `.linkreset` / `.resetlink`

### Sudo / Prefix / Mode
- `.setsudo <number>` or reply
- `.dlsudo <number>` or reply
- `.setprefix <prefix>`
- `.prefix <prefix>`
- `.mode private/public`
- `.settings`
- `.settings <feature> on/off`

### Welcome / Goodbye
- `.setwelcome <message>`
- `.setwelcome default`
- `.setgoodbye <message>`
- `.setgoodbye default`

Welcome/Goodbye are automatic. There are no `.welcome`, `.goodbye`, or `.welcomegroup` commands.

### Music
- `.song <song name or YouTube URL>`
- `.play <song name or YouTube URL>`

Music uses `yt-dlp` first because YouTube extraction can fail with older `ytdl-core` clients. On Termux install it with:
```bash
pkg install python
pip install -U yt-dlp
```

### Group Status
- `.gcstory` — reply to a **photo, video, text, or link** in a group.

The command publishes the replied content as **WhatsApp Group Status for that group**. It does **not** publish to `status@broadcast`.

## Notes
- `antilinkkick on/off` is not needed; `.antilink on` now deletes links and removes the sender automatically.
- `.story` has been removed.
- Anti-sticker and anti-admin are group-specific.
- `.antilink` only deletes links; it no longer performs an automatic kick.


## v1.5.13 fixes
- Commands from the paired WhatsApp account are accepted reliably, including group/self messages.
- Bot-admin detection checks phone/LID/JID forms more robustly.
- Anti-admin, anti-link and anti-sticker keep their per-group scope.
- Anti-sticker retries admin detection before deleting.
- Reconnect guard prevents duplicate bot instances after connection drops.


## Hosting fix (OptikLink / Railway / Render)
- `@adiwajshing/keyed-db@0.2.4` is included explicitly because the Baileys fork imports it at runtime. This prevents `ERR_MODULE_NOT_FOUND` / `Cannot find package '@adiwajshing/keyed-db'` startup crashes.
- Bot-admin detection uses the paired WhatsApp account identity (phone/JID/LID) from the live socket and then checks that exact participant's admin role from fresh group metadata. The configured owner number is not treated as the bot identity, preventing false admin results when those numbers differ.
