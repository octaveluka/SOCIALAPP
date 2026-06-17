---
name: SocialApp architecture
description: Key decisions and constraints for SocialApp Node.js/Express/MongoDB/Socket.io app with 5-brique extension
---

# SocialApp — Architecture & Decisions

## Stack
- Node.js + Express + Socket.io + MongoDB (Mongoose) + EJS views
- Cloudinary for media (photos, audio, AI images)
- Port 5000, host 0.0.0.0 (Replit proxy)
- `app.set('trust proxy', 1)` required for rate-limiter behind Replit's proxy

## Key Files
- `server.js` — main server, all Socket.io events, cron for ephemeral messages
- `lib/aiCommands.js` — all AI command handlers (/+, /imagine, /edit, /sticker, /find, /burn, /send, /roll, /summary, /translate)
- `lib/cloudinary.js` — exports: cloudinary, uploadProfile, uploadPost, uploadGroup, uploadAudio
- `middleware/auth.js` — exports: requireAuth, redirectIfAuth, requireAdmin

## External APIs
- Copilot (text AI): `https://delfaapiai.vercel.app/ai/copilot?message=...&model=default` (GET)
- Image generate: `https://gem-tw6a.onrender.com/generate` (POST, {prompt, ratio, format})
- Image edit: `https://gem-tw6a.onrender.com/edit` (POST, {prompt, image: base64, format})

## Models
- User: xp, walletBalance, isIncognitoInput, theme, vaultedChats (Map), activeSubProfile
- Message: isDeleted, expiresAt, isSticker, isCodeBlock, codeSignature, anonymousName/Avatar
- Group: isPermanent, isSystemGroup, systemGroupKey, isChaosMode, chaosExpiresAt, voiceRoomMembers
- SubProfile: userId, anonymousUsername, anonymousAvatarUrl
- Bounty: title, description, rewardAmount, createdBy, status, claimedBy, applicants

## Routes
- /routes/ai — AI commands API (/api/ai/command, /api/ai/translate)
- /routes/gamification — wallet, shop, bounties (/wallet, /shop, /bounties, /api/shop/buy, /api/bounties/*)
- /routes/security — incognito, PIN vault, subprofiles (/api/settings/*, /api/vault/*, /api/subprofiles/*)
- /routes/voicerooms — WebRTC signaling via Socket.io (/api/groups/:id/voice/*)

## System Groups
- "Avis & Solutions" (systemGroupKey: "avis_solutions") and "Primes" (systemGroupKey: "primes")
- Created on startup via ensureSystemGroups() in routes/auth.js
- New users added to system groups on register AND on each login (sync)
- First non-bot human to register gets role "admin" (count excludes isBot:true users)
- New users receive 100 welcome credits + 10 XP on register

## Themes (CSS data-theme on body)
- default, dark, neon, ocean, sunset, forest
- Applied via head.ejs script reading session userTheme
- Purchased in /shop (uses walletBalance)

**Why:** No Replit branding/advertising anywhere in code or UI — explicit user constraint.
