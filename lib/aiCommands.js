const Message = require("../models/Message")
const User = require("../models/User")
const Group = require("../models/Group")
const { cloudinary } = require("./cloudinary")
const crypto = require("crypto")

const COPILOT_API = "https://delfaapiai.vercel.app/ai/copilot"
const IMAGE_API   = "https://gem-tw6a.onrender.com/generate"
const EDIT_API    = "https://gem-tw6a.onrender.com/edit"

// =============================================
// UTILITAIRES
// =============================================
async function callCopilot(message) {
    try {
        const url = `${COPILOT_API}?message=${encodeURIComponent(message)}&model=default`
        const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
        if (!res.ok) throw new Error(`Copilot HTTP ${res.status}`)
        const data = await res.json()
        return data.response || data.message || data.text || data.result || JSON.stringify(data)
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
    const response = await callCopilot(prompt)
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

    return null
}

module.exports = {
    dispatchCommand,
    handleTranslate,
    signCode,
    callCopilot
}
