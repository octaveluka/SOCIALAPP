require("dotenv").config()
const express = require("express")
const http = require("http")
const { Server } = require("socket.io")
const mongoose = require("mongoose")
const session = require("express-session")
const flash = require("connect-flash")
const path = require("path")
const compression = require("compression")
const rateLimit = require("express-rate-limit")
const crypto = require("crypto")

const User = require("./models/User")
const Message = require("./models/Message")
const Group = require("./models/Group")
const Notification = require("./models/Notification")
const SubProfile = require("./models/SubProfile")
const assistant = require("./lib/assistant")
const { dispatchCommand } = require("./lib/aiCommands")
const { signCode } = require("./lib/aiCommands")

const app = express()
const server = http.createServer(app)
const io = new Server(server)
global.io = io

// =============================================
// CONNEXION MONGODB
// =============================================
mongoose.connect(process.env.MONGO_URI)
    .then(async () => {
        console.log("✅ MongoDB connecté !")
        await assistant.ensureAssistantExists()
        console.log("🤖 Assistant prêt")
        assistant.sendWelcomeToAll()
        // Créer les groupes système si nécessaire
        const { ensureSystemGroups } = require("./routes/auth")
        try { await ensureSystemGroups() } catch(e) { console.log("Groupes système:", e.message) }
        // Cron : nettoyer les messages éphémères
        startEphemeralCleanup()
    })
    .catch(err => console.log("❌ Erreur MongoDB :", err.message))

// =============================================
// NETTOYAGE MESSAGES ÉPHÉMÈRES
// =============================================
function startEphemeralCleanup() {
    setInterval(async () => {
        try {
            const expired = await Message.find({ expiresAt: { $lte: new Date() }, isDeleted: false })
            for (const msg of expired) {
                if (global.io) {
                    const event = msg.groupe ? "group-message-deleted" : "message-deleted"
                    const room = msg.destinataire ? msg.destinataire.toString() : "group_" + msg.groupe
                    global.io.to(room).emit(event, { messageId: msg._id, burned: true })
                    global.io.to(msg.expediteur.toString()).emit(event, { messageId: msg._id, burned: true })
                }
                await Message.findByIdAndDelete(msg._id)
            }
        } catch (e) { console.error("Ephemeral cleanup error:", e.message) }
    }, 10000) // toutes les 10 secondes
}

// =============================================
// RATE LIMITING
// =============================================
app.use(compression({ level: 6, threshold: 1024, filter: (req, res) => {
    if (req.headers['content-type']?.includes('image')) return false
    return compression.filter(req, res)
}}))

const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, message: 'Trop de requêtes.', skip: (req) => req.path === '/health' || req.path === '/' })
const authLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 10, message: 'Trop de tentatives de connexion.' })
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, message: 'Trop de requêtes API.' })

app.use('/auth/login', authLimiter)
app.use('/auth/register', authLimiter)
app.use('/api/', apiLimiter)
app.use(globalLimiter)

// =============================================
// CONFIGURATION EXPRESS
// =============================================
app.set("trust proxy", 1)
app.set("view engine", "ejs")
app.set("views", path.join(__dirname, "views"))
app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use(express.static(path.join(__dirname, "public")))

// =============================================
// SESSIONS
// =============================================
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7, secure: false, sameSite: 'lax', httpOnly: true }
}))
app.use(flash())

// =============================================
// VARIABLES GLOBALES POUR LES VUES
// =============================================
app.use(async (req, res, next) => {
    res.locals.success = req.flash("success")
    res.locals.error = req.flash("error")
    res.locals.user = req.session.user || null

    if (req.session.user) {
        try {
            const currentUser = await User.findById(req.session.user.id)
            res.locals.demandesCount = currentUser ? currentUser.demandesRecues.length : 0
            res.locals.messagesCount = await Message.countDocuments({ destinataire: req.session.user.id, lu: false })
            res.locals.notifCount = await Notification.countDocuments({ destinataire: req.session.user.id, lu: false })
            if (currentUser) {
                req.session.user.role = currentUser.role
                req.session.user.theme = currentUser.theme || "default"
                req.session.user.isIncognitoInput = currentUser.isIncognitoInput || false
                res.locals.userTheme = currentUser.theme || "default"
                res.locals.walletBalance = currentUser.walletBalance || 0
            }
        } catch (e) {
            res.locals.demandesCount = 0
            res.locals.messagesCount = 0
            res.locals.notifCount = 0
        }
    }
    next()
})

// =============================================
// ROUTES
// =============================================
app.use("/", require("./routes/auth"))
app.use("/", require("./routes/feed"))
app.use("/", require("./routes/profile"))
app.use("/", require("./routes/friends"))
app.use("/", require("./routes/messages"))
app.use("/", require("./routes/notifications"))
app.use("/", require("./routes/groups"))
app.use("/", require("./routes/admin"))
app.use("/", require("./routes/assistant-admin"))
app.use("/", require("./routes/ai"))
app.use("/", require("./routes/gamification"))
app.use("/", require("./routes/security"))
app.use("/", require("./routes/voicerooms"))

// =============================================
// SOCKET.IO
// =============================================
io.on("connection", async (socket) => {
    const userId = socket.handshake.query.userId
    if (!userId) return

    socket.join(userId)

    try {
        const user = await User.findById(userId)
        if (user) {
            user.enLigne = true
            await user.save()
            io.emit("user-status", { userId, enLigne: true })
        }
    } catch (e) {}

    // === MESSAGERIE PRIVÉE ===
    socket.on("send-message", async (data) => {
        try {
            const { from, to, contenu, type, audio, duration, replyTo } = data

            if (type === 'text') {
                if (!contenu || contenu.trim().length === 0) return
            } else if (type === 'audio') {
                if (!audio) return
            } else return

            const textContent = type === 'text' ? contenu.trim() : ''

            // Vérifier commandes IA dans les messages privés
            if (type === 'text' && textContent.match(/^\/([\+imagine|edit|summary|sticker|find|burn|send|roll])/)) {
                const cmdResult = await dispatchCommand(textContent, from, { destinataireId: to, replyToId: replyTo || null })
                if (cmdResult && !cmdResult.error) {
                    const msgData = {
                        expediteur: from,
                        destinataire: to,
                        lu: false,
                        repondA: replyTo || null
                    }
                    if (cmdResult.type === 'text') msgData.contenu = cmdResult.content
                    else if (cmdResult.type === 'image' || cmdResult.type === 'sticker') {
                        msgData.image = cmdResult.content
                        msgData.isSticker = cmdResult.type === 'sticker'
                        msgData.contenu = cmdResult.caption || ""
                    } else if (cmdResult.type === 'burn') {
                        msgData.contenu = cmdResult.content
                        msgData.expiresAt = cmdResult.expiresAt
                    }
                    const saved = await Message.create(msgData)
                    const payload = { _id: saved._id, expediteur: from, destinataire: to, ...msgData, type: cmdResult.type, burnSeconds: cmdResult.burnSeconds || null, lu: false }
                    io.to(to).emit("new-message", payload)
                    io.to(from).emit("new-message", payload)

                    // XP
                    await User.findByIdAndUpdate(from, { $inc: { xp: 2 } })
                    return
                } else if (cmdResult && cmdResult.error) {
                    // Renvoyer l'erreur comme message système
                    const errMsg = await Message.create({ expediteur: from, destinataire: to, contenu: `⚠️ ${cmdResult.error}`, lu: false })
                    io.to(from).emit("new-message", { _id: errMsg._id, expediteur: from, destinataire: to, contenu: errMsg.contenu, type: 'text', lu: false })
                    return
                }
            }

            const newMessage = await Message.create({
                expediteur: from,
                destinataire: to,
                contenu: textContent,
                audio: type === 'audio' ? audio : null,
                duration: type === 'audio' ? duration : null,
                repondA: replyTo || null,
                lu: false
            })

            // XP pour message envoyé
            await User.findByIdAndUpdate(from, { $inc: { xp: 1 } })

            let repondAData = null
            if (replyTo) {
                const parent = await Message.findById(replyTo)
                if (parent) repondAData = { _id: parent._id, contenu: parent.contenu, image: parent.image }
            }

            const payload = {
                _id: newMessage._id,
                expediteur: from,
                destinataire: to,
                contenu: newMessage.contenu,
                audio: newMessage.audio,
                duration: newMessage.duration,
                type,
                repondA: repondAData,
                lu: false
            }

            io.to(to).emit("new-message", payload)
            io.to(from).emit("new-message", payload)

            // Notification (VIP check)
            const senderUser = await User.findById(from, "nom")
            const isUrgent = /urgent|important|aide|help|sos|asap/i.test(textContent)
            if (isUrgent || type === 'audio') {
                const notification = await Notification.create({ destinataire: to, expediteur: from, type: "message", lien: "/messages/" + from })
                const notifComplete = await Notification.findById(notification._id).populate("expediteur", "nom photoProfil")
                io.to(to).emit("notification", notifComplete)
            }

            // Assistant
            if (type === 'text') {
                const assistantUser = await User.findOne({ isBot: true })
                const isForAssistant = to === assistantUser?._id?.toString() && from !== assistantUser?._id?.toString()
                const isHelp = textContent.toLowerCase().startsWith('!help') || textContent.toLowerCase().startsWith('!aide')
                if (isForAssistant || isHelp) {
                    await assistant.replyToUser(from, textContent)
                }
            }
        } catch (e) {
            console.log("⚠️ Erreur envoi message :", e.message)
        }
    })

    socket.on("mark-read", async (data) => {
        try {
            const { from, to } = data
            await Message.updateMany({ expediteur: from, destinataire: to, lu: false }, { lu: true })
            io.to(from).emit("messages-read", { by: to })
        } catch (e) {}
    })

    // Typing indicator (avec respect du mode incognito)
    socket.on("typing", async (data) => {
        const { from, to, isTyping } = data
        try {
            const user = await User.findById(from, "isIncognitoInput")
            if (user?.isIncognitoInput) return // Ghost typing : on n'émet rien
        } catch (e) {}
        socket.to(to).emit("typing", { from, isTyping })
    })

    // === GROUPES ===
    socket.on("join-group", (groupId) => { socket.join("group_" + groupId) })

    socket.on("send-group-message", async (data) => {
        try {
            const { from, groupId, contenu, repondA, type, audio, duration } = data

            if (type === 'text') { if (!contenu || contenu.trim().length === 0) return }
            else if (type === 'audio') { if (!audio) return }
            else return

            const group = await Group.findById(groupId).populate("membres.user", "nom")
            if (!group) return
            const membre = group.membres.find(m => m.user._id.toString() === from)
            if (!membre) return

            // Vérifier si chaos mode expiré
            if (group.isChaosMode && group.chaosExpiresAt && new Date() > group.chaosExpiresAt) {
                group.isChaosMode = false
                group.membres.forEach(m => { m.chaosName = null; m.chaosAvatar = null })
                await group.save()
            }

            const textContent = type === 'text' ? contenu.trim() : ''

            // Commandes IA dans les groupes
            if (type === 'text' && textContent.match(/^\/(\+|imagine|edit|sticker|find|burn|send|roll|summary)/)) {
                const cmdResult = await dispatchCommand(textContent, from, { replyToId: repondA || null, groupId })
                if (cmdResult && !cmdResult.error) {
                    const msgData = { expediteur: from, groupe: groupId, lu: false, repondA: repondA || null }
                    if (cmdResult.type === 'text') msgData.contenu = cmdResult.content
                    else if (cmdResult.type === 'image' || cmdResult.type === 'sticker') {
                        msgData.image = cmdResult.content
                        msgData.isSticker = cmdResult.type === 'sticker'
                        msgData.contenu = cmdResult.caption || ""
                    } else if (cmdResult.type === 'burn') {
                        msgData.contenu = cmdResult.content
                        msgData.expiresAt = cmdResult.expiresAt
                    }
                    const saved = await Message.create(msgData)
                    await User.findByIdAndUpdate(from, { $inc: { xp: 2 } })
                    const expediteurUser = await User.findById(from)
                    const payload = {
                        _id: saved._id, expediteur: { _id: from, nom: expediteurUser.nom },
                        pseudo: membre.pseudo || expediteurUser.nom,
                        ...msgData, groupId,
                        type: cmdResult.type, burnSeconds: cmdResult.burnSeconds || null
                    }
                    io.to("group_" + groupId).emit("new-group-message", payload)
                    return
                } else if (cmdResult && cmdResult.error) {
                    const expediteurUser = await User.findById(from)
                    io.to(from).emit("new-group-message", {
                        _id: Date.now(), expediteur: { _id: from, nom: "Système" },
                        pseudo: "Système", contenu: `⚠️ ${cmdResult.error}`, groupId, type: 'text'
                    })
                    return
                }
            }

            // Sous-profil anonyme ?
            const senderUser = await User.findById(from).populate("activeSubProfile")
            const activeSubProfile = senderUser?.activeSubProfile
            const chaosOverride = group.isChaosMode ? group.membres.find(m => m.user._id.toString() === from) : null

            const newMessage = await Message.create({
                expediteur: from,
                groupe: groupId,
                contenu: type === 'text' ? textContent : '',
                audio: type === 'audio' ? audio : null,
                duration: type === 'audio' ? duration : null,
                repondA: repondA || null,
                subProfileId: activeSubProfile?._id || null,
                anonymousName: chaosOverride?.chaosName || activeSubProfile?.anonymousUsername || null,
                anonymousAvatar: chaosOverride?.chaosAvatar || activeSubProfile?.anonymousAvatarUrl || null
            })

            await User.findByIdAndUpdate(from, { $inc: { xp: 1 } })

            let repondAData = null
            if (repondA) {
                const original = await Message.findById(repondA)
                if (original) repondAData = { contenu: original.contenu, image: original.image }
            }

            const displayName = chaosOverride?.chaosName || activeSubProfile?.anonymousUsername || membre.pseudo || senderUser.nom
            const displayAvatar = chaosOverride?.chaosAvatar || activeSubProfile?.anonymousAvatarUrl || null

            const payload = {
                _id: newMessage._id,
                expediteur: { _id: from, nom: senderUser.nom },
                pseudo: displayName,
                anonymousAvatar: displayAvatar,
                isAnonymous: !!(chaosOverride?.chaosName || activeSubProfile),
                contenu: newMessage.contenu,
                audio: newMessage.audio,
                duration: newMessage.duration,
                type,
                repondA: repondAData,
                groupId
            }

            io.to("group_" + groupId).emit("new-group-message", payload)

            // Mentions
            const mentionMatches = textContent.match(/@(\w+)/g)
            if (mentionMatches) {
                for (const mention of mentionMatches) {
                    const pseudoMentionne = mention.slice(1).toLowerCase()
                    const membreMentionne = group.membres.find(m => {
                        const p = m.pseudo || m.user.nom
                        return p.toLowerCase() === pseudoMentionne && m.user._id.toString() !== from
                    })
                    if (membreMentionne) {
                        const notif = await Notification.create({ destinataire: membreMentionne.user._id, expediteur: from, type: "message", lien: "/groups/" + groupId })
                        const notifComplete = await Notification.findById(notif._id).populate("expediteur", "nom photoProfil")
                        io.to(membreMentionne.user._id).emit("notification", notifComplete)
                    }
                }
            }
        } catch (e) {
            console.log("⚠️ Erreur message groupe :", e.message)
        }
    })

    socket.on("react-message", async (data) => {
        try {
            const { messageId, groupId, userId, emoji } = data
            const message = await Message.findById(messageId)
            if (!message) return
            message.reactions = message.reactions.filter(r => r.user.toString() !== userId)
            message.reactions.push({ user: userId, emoji })
            await message.save()
            io.to("group_" + groupId).emit("message-reacted", { messageId, groupId, reactions: message.reactions })
        } catch (e) {}
    })

    // === CHAOS MODE ===
    socket.on("start-chaos-mode", async (data) => {
        try {
            const { groupId, durationMinutes } = data
            const group = await Group.findById(groupId).populate("membres.user", "nom photoProfil")
            if (!group) return
            const requestingMembre = group.membres.find(m => m.user._id.toString() === userId)
            if (!requestingMembre?.isAdmin) return

            const emojis = ["🐺","🦊","🐻","🦁","🐯","🦝","🐸","🐙","🦋","🐬","🦈","🐧","🦜","🦄","🐲"]
            const names = ["Fantôme","Ombre","Ninja","Spectre","Mystère","Inconnu","Masqué","Secret","Pixel","Nova"]

            group.membres.forEach(m => {
                const emoji = emojis[Math.floor(Math.random() * emojis.length)]
                const name = names[Math.floor(Math.random() * names.length)]
                const num = Math.floor(Math.random() * 9000) + 1000
                m.chaosName = `${name}${num}`
                m.chaosAvatar = `https://ui-avatars.com/api/?background=374151&color=fff&name=${emoji}&bold=true`
            })
            group.isChaosMode = true
            group.chaosExpiresAt = new Date(Date.now() + (durationMinutes || 5) * 60 * 1000)
            await group.save()

            const chaosMap = {}
            group.membres.forEach(m => {
                chaosMap[m.user._id.toString()] = { name: m.chaosName, avatar: m.chaosAvatar }
            })

            io.to("group_" + groupId).emit("chaos-mode-started", { groupId, chaosMap, durationMinutes: durationMinutes || 5 })
        } catch (e) { console.error("Chaos mode error:", e.message) }
    })

    socket.on("stop-chaos-mode", async (data) => {
        try {
            const { groupId } = data
            const group = await Group.findById(groupId)
            if (!group) return
            const requestingMembre = group.membres.find(m => m.user.toString() === userId)
            if (!requestingMembre?.isAdmin) return
            group.isChaosMode = false
            group.membres.forEach(m => { m.chaosName = null; m.chaosAvatar = null })
            await group.save()
            io.to("group_" + groupId).emit("chaos-mode-ended", { groupId })
        } catch (e) {}
    })

    // === VOICE ROOM WebRTC SIGNALING ===
    socket.on("voice-offer", (data) => {
        const { to, from, offer, groupId } = data
        io.to(to).emit("voice-offer", { from, offer, groupId })
    })
    socket.on("voice-answer", (data) => {
        const { to, from, answer, groupId } = data
        io.to(to).emit("voice-answer", { from, answer, groupId })
    })
    socket.on("voice-ice", (data) => {
        const { to, candidate, groupId } = data
        io.to(to).emit("voice-ice", { from: userId, candidate, groupId })
    })

    // === WATCH PARTY ===
    socket.on("watch-party-sync", (data) => {
        const { groupId, action, currentTime, url } = data
        socket.to("group_" + groupId).emit("watch-party-sync", { action, currentTime, url, from: userId })
    })

    // === FOCUS MODE (éditeur collaboratif) ===
    socket.on("focus-update", (data) => {
        const { groupId, content } = data
        socket.to("group_" + groupId).emit("focus-update", { content, from: userId })
    })

    // Déconnexion
    socket.on("disconnect", async () => {
        try {
            const user = await User.findById(userId)
            if (user) {
                user.enLigne = false
                user.derniereConnexion = new Date()
                await user.save()
                io.emit("user-status", { userId, enLigne: false })
            }
            // Retirer des salons vocaux
            const groupsWithVoice = await Group.find({ voiceRoomMembers: userId })
            for (const grp of groupsWithVoice) {
                grp.voiceRoomMembers = grp.voiceRoomMembers.filter(m => m.toString() !== userId)
                if (grp.voiceRoomMembers.length === 0) grp.voiceRoomActive = false
                await grp.save()
                io.to("group_" + grp._id).emit("voice-room-update", { groupId: grp._id, action: "leave", userId })
            }
        } catch (e) {}
    })
})

// =============================================
// DÉMARRAGE
// =============================================
const PORT = process.env.PORT || 5000
server.listen(PORT, "0.0.0.0", () => {
    console.log(`🌐 Serveur démarré sur http://0.0.0.0:${PORT}`)
})
