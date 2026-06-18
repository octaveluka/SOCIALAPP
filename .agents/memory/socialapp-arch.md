---
name: SocialApp architecture
description: Key decisions and constraints for SocialApp Node.js/Express/MongoDB/Socket.io app
---

# SocialApp — Architecture & Decisions

## Stack
- Node.js + Express + Socket.io + MongoDB (Mongoose) + EJS views
- Cloudinary for media (photos, audio, AI images)
- Port 5000, host 0.0.0.0 (Replit proxy)
- `app.set('trust proxy', 1)` required for rate-limiter behind Replit's proxy

## Key Files
- `server.js` — main server, all Socket.io events, cron for ephemeral messages
- `lib/aiCommands.js` — AI command handlers; commands regex in server.js must use `/^\/[a-z+]/i` (not a hardcoded list)
- `lib/cloudinary.js` — exports: cloudinary, uploadProfile, uploadPost, uploadGroup, uploadAudio
- `middleware/auth.js` — exports: requireAuth, redirectIfAuth, requireAdmin

## External APIs
- Copilot (text AI): `https://delfaapiai.vercel.app/ai/copilot?message=...&model=default` (GET)
- Image generate: `https://gem-tw6a.onrender.com/generate` (POST, {prompt, ratio, format})
- Image edit: `https://gem-tw6a.onrender.com/edit` (POST, {prompt, image: base64, format})
- DevOps health check targets `/health` on gem-tw6a; alerts sent to avis_solutions group via sendSystemAlert()

## Models
- User: xp, walletBalance, isIncognitoInput, theme, vaultedChats (Map), activeSubProfile, aiCloneActive
- Message: isDeleted, expiresAt, isSticker, isCodeBlock, codeSignature, anonymousName/Avatar
- Group: isPermanent, isSystemGroup, systemGroupKey, isChaosMode, chaosExpiresAt, voiceRoomMembers
- SubProfile: userId, anonymousUsername, anonymousAvatarUrl
- Bounty: title, description, actionType (10 predefined IDs), rewardAmount, createdBy, status, claimedBy, applicants (with verified flag), groupId

## Routes
- /routes/gamification — wallet, shop, bounties + clone toggle
  - POST /api/bounties → create (admin bypass balance)
  - GET /api/bounties/active → for Primes group panel
  - GET /api/bounties/:id/applicants → owner only
  - POST /api/bounties/:id/accomplish → auto-verify + award (no manual approval)
  - POST /api/clone/toggle → toggle aiCloneActive on own profile
- /routes/dailytasks — daily tasks for Primes group
- /routes/security — incognito, PIN vault, subprofiles

## Bounty System
- 10 predefined actionTypes; user picks from dropdown (no free text)
- Auto-verification via verifyBountyAction() in gamification.js
- Admins exempt from balance deduction for both bounties and shop items
- Admins see "∞ Illimité" on wallet, profile, and bounties pages

## Gamification
- Activity reward: every 5 group messages/day → +5 credits SILENT (dailyGroupMsgMap in server.js)
- daily tasks in /routes/dailytasks.js; generated at server start + on first API call if missing
- XP: +1 per group message, +2 per AI command

## System Groups
- "Avis & Solutions" (systemGroupKey: "avis_solutions") and "Primes" (systemGroupKey: "primes")
- Primes group replaces chat with tasks panel + bounties panel + admin create form
- DevOps bot alerts go to avis_solutions (30-min cooldown, 10-min check interval)
- New users added to system groups on register AND on each login (sync)
- Admin guaranteed: octaveluka@gmail.com forced admin on every startup

## AI Clone
- aiCloneActive field on User (bool, default false)
- Toggle button on own profile → POST /api/clone/toggle
- When recipient has clone active: auto-reply in private messages using their last 5 posts as context
- Reply prefixed with "🎭 *Clone IA* :"

## AI Commands (lib/aiCommands.js)
- /+ → copilot, /imagine → image gen, /edit → image edit, /sticker → sticker, /find → user search
- /burn → timed message, /send → forward, /roll → dice, /summary → group summary
- /help /ping /flip /quote /time /who /calc → utility commands
- /poll Question|Opt1|Opt2 → predictive poll with AI winner prediction
- commands regex in server.js: /^\/[a-z+]/i (covers ALL slash commands)

## Anti-Screenshot Watermark
- Fixed overlay injected via JS at bottom of chat.ejs and group-chat.ejs
- opacity: 0.026-0.028, rotated text rows with user._id, pointer-events:none, z-index:9997

**Why:** No Replit branding/advertising anywhere in code or UI — explicit user constraint.
