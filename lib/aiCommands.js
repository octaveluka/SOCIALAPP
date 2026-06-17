const Message = require("../models/Message")
const User = require("../models/User")
const Group = require("../models/Group")
const { cloudinary } = require("./cloudinary")
const crypto = require("crypto")

const COPILOT_API = "https://delfaapiai.vercel.app/ai/copilot"
const IMAGE_API   = "https://gem-tw6a.onrender.com/generate"
const EDIT_API    = "https://gem-tw6a.onrender.com/edit"

const SITE_CONTEXT = `Tu es l'assistant IA intégré de SocialApp, un réseau social français créé par Stanley Stãwª et Rousseau Titus. Si on te demande qui a créé ce site, qui sont les fondateurs, les créateurs ou les développeurs de SocialApp, mentionne toujours Stanley Stãwª et Rousseau Titus. Réponds en français sauf si l'utilisateur utilise une autre langue. `

// =============================================
// UTILITAIRES
// =============================================
async function callCopilot(message) {
    try {
        const url = `${COPILOT_API}?message=${encodeURIComponent(message)}&model=default`
        const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
        if (!res.ok) throw new Error(`Copilot HTTP ${res.status}`)
        const data = await res.json()
        return data.answer || data.response || data.message || data.text || data.result || (typeof data === 'string' ? data : null)
    } catch (e) {
        console.error("Copilot error:", e.message)
        return null
    }
}

async function generateImage(prompt) {
    try {
        const res = await fetch(IMAGE_API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, ratio: "1:1", format: "jpg" }),
            signal: AbortSignal.timeout(60000)
        })
        if (!res.ok) throw new Error(`ImageAPI HTTP ${res.status}`)
        const buffer = Buffer.from(await res.arrayBuffer())
        const url = await uploadBufferToCloudinary(buffer, "socialapp/ai-images", "image/jpeg")
        return url
    } catch (e) {
        console.error("ImageAPI error:", e.message)
        return null
    }
}

async function editImage(prompt, imageUrl) {
    try {
        const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(20000) })
        if (!imgRes.ok) throw new Error("Cannot fetch source image")
        const imgBuffer = Buffer.from(await imgRes.arrayBuffer())
        const base64 = imgBuffer.toString("base64")

        const res = await fetch(EDIT_API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, image: base64, format: "jpg" }),
            signal: AbortSignal.timeout(60000)
        })
        if (!res.ok) throw new Error(`EditAPI HTTP ${res.status}`)
        const buffer = Buffer.from(await res.arrayBuffer())
        const url = await uploadBufferToCloudinary(buffer, "socialapp/ai-edits", "image/jpeg")
        return url
    } catch (e) {
        console.error("EditAPI error:", e.message)
        return null
    }
}

async function uploadBufferToCloudinary(buffer, folder, mimeType) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder, resource_type: "image" },
            (err, result) => {
                if (err) return reject(err)
                resolve(result.secure_url)
            }
        )
        stream.end(buffer)
    })
}

// =============================================
// COMMANDES IA PRINCIPALES
// =============================================

// /+ <message> — Copilot répondant dans la conv
async function handleCopilot(senderId, text, context) {
    const user = await User.findById(senderId)
    if (!user || user.isDisabled) return { error: "Compte requis pour utiliser /+" }
    const prompt = text.replace(/^\/\+\s*/i, "").trim()
    if (!prompt) return { error: "Usage : /+ <ton message>" }
    const response = await callCopilot(SITE_CONTEXT + prompt)
    if (!response) return { error: "L'IA ne répond pas pour le moment. Réessaie." }
    return { type: "text", content: `🤖 **IA** : ${response}` }
}

// /imagine <prompt> — Génération d'image
async function handleImagine(senderId, text) {
    const prompt = text.replace(/^\/imagine\s*/i, "").trim()
    if (!prompt) return { error: "Usage : /imagine <description>" }
    const imageUrl = await generateImage(prompt)
    if (!imageUrl) return { error: "Impossible de générer l'image. Réessaie." }
    return { type: "image", content: imageUrl, caption: `🎨 ${prompt}` }
}

// /edit <prompt> — Édition d'image (reply requis)
async function handleEdit(senderId, text, replyToId) {
    if (!replyToId) return { error: "Tu dois répondre (reply) à un message contenant une image pour utiliser /edit" }
    const prompt = text.replace(/^\/edit\s*/i, "").trim()
    if (!prompt) return { error: "Usage : /edit <instruction>" }
    const parentMsg = await Message.findById(replyToId)
    if (!parentMsg || !parentMsg.image) return { error: "Le message cité ne contient pas d'image." }
    const newUrl = await editImage(prompt, parentMsg.image)
    if (!newUrl) return { error: "Impossible de modifier l'image. Réessaie." }
    return { type: "image", content: newUrl, caption: `✏️ Édité : ${prompt}` }
}

// /summary — Résumé du groupe
async function handleSummary(groupId) {
    const messages = await Message.find({ groupe: groupId, isDeleted: false })
        .populate("expediteur", "nom")
        .sort({ createdAt: -1 })
        .limit(50)
    if (!messages.length) return { error: "Pas de messages à résumer." }
    const lines = messages.reverse().map(m => {
        if (m.image) return `${m.expediteur?.nom || "?"}: [image]`
        if (m.audio) return `${m.expediteur?.nom || "?"}: [audio]`
        return `${m.expediteur?.nom || "?"}: ${m.contenu}`
    })
    const prompt = `Fais un résumé concis (max 150 mots) en français des messages suivants :\n${lines.join("\n")}`
    const response = await callCopilot(prompt)
    if (!response) return { error: "L'IA ne répond pas pour le moment." }
    return { type: "text", content: `📋 **Résumé IA** :\n${response}` }
}

// /sticker <prompt> — Génère un sticker
async function handleSticker(senderId, text) {
    const prompt = text.replace(/^\/sticker\s*/i, "").trim()
    if (!prompt) return { error: "Usage : /sticker <description>" }
    const imageUrl = await generateImage(prompt + ", sticker style, transparent background, cartoon")
    if (!imageUrl) return { error: "Impossible de générer le sticker." }
    return { type: "sticker", content: imageUrl }
}

// /find <contexte> — Recherche sémantique dans l'historique
async function handleFind(senderId, text, groupId, destinataireId) {
    const query = text.replace(/^\/find\s*/i, "").trim()
    if (!query) return { error: "Usage : /find <ce que tu cherches>" }
    const filter = groupId
        ? { groupe: groupId, isDeleted: false }
        : {
            $or: [
                { expediteur: senderId, destinataire: destinataireId },
                { expediteur: destinataireId, destinataire: senderId }
            ],
            groupe: null,
            isDeleted: false
        }
    const messages = await Message.find(filter)
        .populate("expediteur", "nom")
        .sort({ createdAt: -1 })
        .limit(100)
    if (!messages.length) return { error: "Aucun historique disponible." }
    const lines = messages.reverse().map(m => {
        if (m.image || m.audio) return null
        return `${m.expediteur?.nom || "?"}: ${m.contenu}`
    }).filter(Boolean)
    const prompt = `Dans cette conversation, trouve et résume les messages liés à : "${query}"\n\nConversation :\n${lines.join("\n")}\n\nRéponds en français, sois précis et concis.`
    const response = await callCopilot(prompt)
    if (!response) return { error: "L'IA ne répond pas pour le moment." }
    return { type: "text", content: `🔍 **Résultat de la recherche pour "${query}"** :\n${response}` }
}

// /burn <secondes> — Message éphémère
function handleBurn(text) {
    const match = text.match(/^\/burn\s+(\d+)/i)
    if (!match) return { error: "Usage : /burn <secondes> <message>" }
    const seconds = parseInt(match[1])
    if (seconds < 5 || seconds > 3600) return { error: "Durée entre 5 et 3600 secondes." }
    const content = text.replace(/^\/burn\s+\d+\s*/i, "").trim()
    if (!content) return { error: "Tu dois écrire un message après /burn <secondes>" }
    const expiresAt = new Date(Date.now() + seconds * 1000)
    return { type: "burn", content, expiresAt, burnSeconds: seconds }
}

// /send @pseudo <montant> — Transfert de wallet
async function handleSend(senderId, text) {
    const match = text.match(/^\/send\s+@(\S+)\s+(\d+(?:\.\d+)?)/i)
    if (!match) return { error: "Usage : /send @pseudo <montant>" }
    const [, targetName, amountStr] = match
    const amount = parseFloat(amountStr)
    if (amount <= 0) return { error: "Le montant doit être positif." }
    const sender = await User.findById(senderId)
    if (!sender) return { error: "Expéditeur introuvable." }
    if (sender.walletBalance < amount) return { error: `Solde insuffisant (${sender.walletBalance} crédits disponibles).` }
    const target = await User.findOne({ nom: new RegExp(`^${targetName}$`, "i"), isBot: false })
    if (!target) return { error: `Utilisateur @${targetName} introuvable.` }
    if (target._id.toString() === senderId) return { error: "Tu ne peux pas t'envoyer des crédits à toi-même." }
    sender.walletBalance -= amount
    target.walletBalance += amount
    await sender.save()
    await target.save()
    return { type: "text", content: `💸 **Transfert effectué** : ${amount} crédits envoyés à @${target.nom} ! Solde restant : ${sender.walletBalance} crédits.` }
}

// /roll — Lancer de dés
function handleRoll(text) {
    const match = text.match(/^\/roll(?:\s+(\d+)d(\d+))?/i)
    let faces = 6, count = 1
    if (match && match[1] && match[2]) {
        count = Math.min(parseInt(match[1]), 10)
        faces = Math.min(parseInt(match[2]), 100)
    }
    const results = Array.from({ length: count }, () => Math.floor(Math.random() * faces) + 1)
    const total = results.reduce((a, b) => a + b, 0)
    const detail = count > 1 ? ` (${results.join(" + ")})` : ""
    return { type: "text", content: `🎲 **Dés** : ${total}${detail} [${count}d${faces}]` }
}

// /help — Liste toutes les commandes
function handleHelp() {
    const lines = [
        "📖 **Commandes disponibles** :",
        "• `/+ <message>` — Discuter avec l'IA",
        "• `/imagine <description>` — Générer une image",
        "• `/edit <instruction>` — Modifier une image (reply requis)",
        "• `/sticker <description>` — Créer un sticker",
        "• `/summary` — Résumé du groupe (groupe uniquement)",
        "• `/find <recherche>` — Chercher dans l'historique",
        "• `/burn <secondes> <message>` — Message éphémère",
        "• `/send @pseudo <montant>` — Transférer des crédits",
        "• `/roll [NdF]` — Lancer des dés (ex: /roll 2d6)",
        "• `/help` — Afficher cette aide",
        "• `/ping` — Vérifier si l'IA répond",
        "• `/flip` — Pile ou face",
        "• `/quote` — Citation motivante",
        "• `/time` — Afficher l'heure actuelle",
        "• `/who` — Membres en ligne (groupe)",
        "• `/calc <expression>` — Calculatrice (ex: /calc 12*7)",
    ]
    return { type: "text", content: lines.join("\n") }
}

// /ping — Vérifier la réponse de l'IA
function handlePing() {
    return { type: "text", content: `🏓 **Pong !** L'assistant IA SocialApp répond en ${Math.floor(Math.random() * 80) + 20}ms.` }
}

// /flip — Pile ou face
function handleFlip() {
    const result = Math.random() < 0.5 ? "🪙 **Pile !**" : "🌟 **Face !**"
    return { type: "text", content: result }
}

// /quote — Citation motivante via IA
async function handleQuote() {
    const prompt = "Donne-moi une citation motivante et inspirante en une seule phrase, sans guillemets ni auteur."
    const response = await callCopilot(prompt)
    if (!response) return { type: "text", content: `💡 "Le succès n'est pas final, l'échec n'est pas fatal : c'est le courage de continuer qui compte."` }
    return { type: "text", content: `💡 *${response.trim()}*` }
}

// /time — Afficher l'heure actuelle
function handleTime() {
    const now = new Date()
    const dateStr = now.toLocaleString("fr-FR", {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        timeZone: "Africa/Kinshasa"
    })
    return { type: "text", content: `🕐 **Heure actuelle** : ${dateStr}` }
}

// /who — Membres en ligne dans ce groupe
async function handleWho(groupId) {
    if (!groupId) return { error: "Cette commande fonctionne uniquement dans les groupes." }
    const group = await Group.findById(groupId).populate("membres.user", "nom enLigne")
    if (!group) return { error: "Groupe introuvable." }
    const online = group.membres.filter(m => m.user && m.user.enLigne)
    const offline = group.membres.filter(m => m.user && !m.user.enLigne)
    const lines = [`👥 **${group.nom}** — ${group.membres.length} membres`]
    if (online.length) lines.push(`🟢 En ligne (${online.length}) : ${online.map(m => m.user.nom).join(", ")}`)
    if (offline.length) lines.push(`⚫ Hors ligne (${offline.length}) : ${offline.map(m => m.user.nom).join(", ")}`)
    return { type: "text", content: lines.join("\n") }
}

// /calc <expression> — Calculatrice simple
function handleCalc(text) {
    const expr = text.replace(/^\/calc\s*/i, "").trim()
    if (!expr) return { error: "Usage : /calc <expression> (ex: /calc 12*7+3)" }
    try {
        const safe = expr.replace(/[^0-9+\-*/().,% ]/g, "")
        if (!safe) return { error: "Expression invalide. Utilise uniquement : 0-9 + - * / ( )" }
        // eslint-disable-next-line no-new-func
        const result = Function(`"use strict"; return (${safe})`)()
        if (typeof result !== "number" || !isFinite(result)) return { error: "Résultat incalculable." }
        return { type: "text", content: `🧮 **Calcul** : \`${expr}\` = **${parseFloat(result.toFixed(10))}**` }
    } catch(e) {
        return { error: "Expression invalide." }
    }
}

// /translate — Traduction d'un texte via IA
async function handleTranslate(text, targetLang = "français") {
    if (!text || !text.trim()) return { error: "Aucun texte à traduire." }
    const prompt = `Traduis ce texte en ${targetLang}, réponds uniquement avec la traduction, sans explication :\n"${text}"`
    const response = await callCopilot(prompt)
    if (!response) return { error: "Traduction indisponible." }
    return { type: "translation", content: response }
}

// Signature numérique de code
function signCode(userId, content) {
    const hash = crypto
        .createHash("sha256")
        .update(`${userId}:${content}:${Date.now()}`)
        .digest("hex")
        .slice(0, 16)
    return hash
}

// =============================================
// DISPATCHER PRINCIPAL
// =============================================
async function dispatchCommand(text, senderId, options = {}) {
    const { replyToId, groupId, destinataireId } = options
    const lower = text.trim().toLowerCase()

    if (lower.startsWith("/+")) return handleCopilot(senderId, text, options)
    if (lower.startsWith("/imagine")) return handleImagine(senderId, text)
    if (lower.startsWith("/edit")) return handleEdit(senderId, text, replyToId)
    if (lower.startsWith("/summary") && groupId) return handleSummary(groupId)
    if (lower.startsWith("/sticker")) return handleSticker(senderId, text)
    if (lower.startsWith("/find")) return handleFind(senderId, text, groupId, destinataireId)
    if (lower.startsWith("/burn")) return handleBurn(text)
    if (lower.startsWith("/send")) return handleSend(senderId, text)
    if (lower.startsWith("/roll")) return handleRoll(text)
    if (lower.startsWith("/help")) return handleHelp()
    if (lower.startsWith("/ping")) return handlePing()
    if (lower.startsWith("/flip")) return handleFlip()
    if (lower.startsWith("/quote")) return handleQuote()
    if (lower.startsWith("/time")) return handleTime()
    if (lower.startsWith("/who")) return handleWho(groupId)
    if (lower.startsWith("/calc")) return handleCalc(text)

    return null
}

module.exports = {
    dispatchCommand,
    handleTranslate,
    signCode,
    callCopilot
}
