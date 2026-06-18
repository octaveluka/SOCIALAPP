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
- `server.js` — main server, all Socket.io events, cron for ephemeral messages + ephemeral group cleanup
- `lib/aiCommands.js` — AI command handlers; commands regex in server.js must use `/^\/[a-z+]/i` (not a hardcoded list)
- `lib/cloudinary.js` — exports: cloudinary, uploadProfile, uploadPost, uploadGroup, uploadAudio
- `middleware/auth.js` — exports: requireAuth, redirectIfAuth, requireAdmin

## External APIs
- Copilot (text AI): `https://delfaapiai.vercel.app/ai/copilot?message=...&model=default` (GET)
- Image generate: `https://gem-tw6a.onrender.com/generate` (POST, {prompt, ratio, format})
- Image edit: `https://gem-tw6a.onrender.com/edit` (POST, {prompt, image: base64, format})
- DevOps health check targets `/health` on gem-tw6a; alerts sent to avis_solutions group via sendSystemAlert()

## Models
- User: xp, walletBalance, isIncognitoInput, theme (10 themes), vaultedChats (Map), activeSubProfile,
  aiCloneActive, aiCloneInstructions (500 chars max), xpBoostExpiry (Date), profileTitle (String),
  profileFrame (enum: bronze/argent/or/diamant), lastFreeCredits (Date)
- Message: isDeleted, expiresAt, isSticker, isCodeBlock, codeSignature, anonymousName/Avatar
- Group: isPermanent, isSystemGroup, systemGroupKey, isChaosMode, chaosExpiresAt, voiceRoomMembers,
  isEphemeral (bool), expiresAt (Date)
- SubProfile: userId, anonymousUsername, anonymousAvatarUrl
- Bounty: title, description, actionType (10 predefined IDs), rewardAmount, createdBy, status, claimedBy, applicants (with verified flag), groupId

## Routes
- /routes/gamification — wallet, shop (25 items in 5 categories), bounties, clone toggle + instructions
  - POST /api/bounties → create (admin bypass balance)
  - GET /api/bounties/active → for Primes group panel
  - POST /api/bounties/:id/accomplish → auto-verify + award
  - POST /api/clone/toggle → toggle aiCloneActive on own profile
  - POST /api/clone/instructions → save aiCloneInstructions (max 500 chars)
  - POST /api/shop/buy → handles types: theme, xpboost, title, frame, badge, credits
- /routes/groups — GET/POST /salons/new for ephemeral salons; site admins auto-added as group admin
- /routes/dailytasks — daily tasks for Primes group
- /routes/security — incognito, PIN vault, subprofiles

## Shop Items (25 articles, 5 categories)
- Thèmes (10): default(free), dark(200), ocean(300), sunset(300), forest(300), neon(350), rose(350), minuit(400), cyberpunk(400), galaxie(500)
- Boosts (5): xpboost_1d(300/24h), xpboost_3d(700/3j), xpboost_7d(1500/7j), credits_50(free 1x/week), credits_pack(2000→3000cr)
- Titres (5): Pro(300), Expert(500), VIP(700), Élite(1000), Légende(2500)
- Cadres (4): bronze(150), argent(400), or(800), diamant(2000)
- Badges (1): premium(750)

## Bounty System
- 10 predefined actionTypes; user picks from dropdown (no free text)
- Auto-verification via verifyBountyAction()
- Admins exempt from balance deduction for both bounties and shop items

## Gamification
- Activity reward: every 5 group messages/day → +5 credits SILENT (dailyGroupMsgMap in server.js)
- XP boost: when xpBoostExpiry > now, XP multiplied ×2 (group msg: 2→4, AI cmd: 1→2)
- XP: +1 per group message, +2 per AI command (doubled with boost)

## Site Admin = Group Admin
- In GET /groups/:id: if user.role==="admin" and not already member → auto-added to group as admin in DB
- isAdmin in template = isSiteAdmin || membre.isAdmin
- **Why:** Site admins need full visibility and control over all groups without manual membership

## Ephemeral Salons
- Created via GET/POST /salons/new (in routes/groups.js)
- Group fields: isEphemeral=true, expiresAt=Date
- On access: expired ephemeral groups auto-delete themselves + their messages and redirect
- Cleanup cron in server.js: runs every hour, deletes all expired ephemeral groups + messages
- Shown with ⏳ badge and expiry time in /messages list
- Duration: 1h to 7 days (168h max), default 24h

## AI Clone
- aiCloneActive field on User (bool, default false)
- aiCloneInstructions: custom prompt text (max 500 chars), shown only when clone is active
- Toggle button on own profile → POST /api/clone/toggle (also shows/hides instructions card)
- Save instructions → POST /api/clone/instructions
- When recipient has clone active: auto-reply uses last 5 posts as context + custom instructions
- Reply prefixed with "🎭 *Clone IA* :"

## Real-time Messages Fix (chat.ejs)
- chat.ejs now reuses window.notificationSocket instead of creating a new io() connection
- Uses socket.off() to clear old listeners before rebinding (prevents duplicate events on navigation)

## Watch Party Fix (group-chat.ejs)
- getYoutubeEmbedUrl() detects YouTube (youtu.be, youtube.com) and Twitch URLs → returns embed URL
- loadWatchPartyUrl() switches between <iframe> (YouTube/Twitch) and <video> (direct MP4) automatically
- Other members receive watch-party-sync event and auto-open the panel + load the same URL

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
