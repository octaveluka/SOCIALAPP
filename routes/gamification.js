const express = require("express")
const router = express.Router()
const { requireAuth } = require("../middleware/auth")
const User = require("../models/User")
const Bounty = require("../models/Bounty")
const Post = require("../models/Post")
const Message = require("../models/Message")

const XP_THRESHOLDS = { bronze: 100, argent: 500, or: 2000, platine: 10000 }

const SHOP_ITEMS = [
    { id: "dark",    name: "Thème Nuit",    price: 200, theme: "dark",    emoji: "🌙" },
    { id: "neon",    name: "Thème Néon",    price: 350, theme: "neon",    emoji: "⚡" },
    { id: "ocean",   name: "Thème Océan",   price: 300, theme: "ocean",   emoji: "🌊" },
    { id: "sunset",  name: "Thème Coucher", price: 300, theme: "sunset",  emoji: "🌅" },
    { id: "forest",  name: "Thème Forêt",   price: 300, theme: "forest",  emoji: "🌿" },
    { id: "default", name: "Thème Défaut",  price: 0,   theme: "default", emoji: "🎨" },
]

const BOUNTY_ACTION_TYPES = [
    { id: "like_post",    label: "👍 Liker ma dernière publication",        desc: "Va liker la dernière publication du créateur" },
    { id: "comment_post", label: "💬 Commenter une publication du créateur", desc: "Commente l'une des publications du créateur aujourd'hui" },
    { id: "add_friend",   label: "🤝 M'envoyer une demande d'ami",           desc: "Envoie une demande d'ami au créateur" },
    { id: "publish_post", label: "📝 Publier une actualité aujourd'hui",     desc: "Publie une actualité sur ton profil aujourd'hui" },
    { id: "use_ai",       label: "🤖 Utiliser une commande IA",              desc: "Utilise /+ ou /imagine dans n'importe quel chat" },
    { id: "send_5_msgs",  label: "✉️ Envoyer 5 messages dans les chats",     desc: "Envoie 5 messages dans les groupes ou en privé" },
    { id: "like_3_posts", label: "❤️ Liker 3 publications de la communauté", desc: "Aime 3 publications de n'importe quel utilisateur" },
    { id: "write_2_cmts", label: "✍️ Écrire 2 commentaires aujourd'hui",     desc: "Écris 2 commentaires sur des publications" },
    { id: "change_avatar",label: "🖼️ Modifier sa photo de profil",           desc: "Mets à jour ta photo de profil (confiance)" },
    { id: "join_group",   label: "👥 Rejoindre un groupe de la communauté",  desc: "Rejoins n'importe quel groupe ouvert" },
]

async function verifyBountyAction(userId, actionType, creatorId) {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    try {
        switch (actionType) {
            case "like_post": {
                const post = await Post.findOne({ auteur: creatorId }).sort({ createdAt: -1 })
                if (!post) return { ok: false, reason: "Le créateur n'a aucune publication." }
                return post.likes.some(id => id.toString() === userId)
                    ? { ok: true }
                    : { ok: false, reason: "Tu n'as pas encore liké la dernière publication du créateur." }
            }
            case "comment_post": {
                const posts = await Post.find({ auteur: creatorId })
                const done = posts.some(p => p.commentaires.some(c =>
                    c.auteur && c.auteur.toString() === userId && new Date(c.createdAt) >= today
                ))
                return done ? { ok: true } : { ok: false, reason: "Tu n'as pas commenté une publication du créateur aujourd'hui." }
            }
            case "add_friend": {
                const creator = await User.findById(creatorId)
                const ok = creator.amis.some(id => id.toString() === userId) ||
                           creator.demandesRecues.some(id => id.toString() === userId)
                return ok ? { ok: true } : { ok: false, reason: "Tu n'as pas encore envoyé de demande d'ami au créateur." }
            }
            case "publish_post": {
                const count = await Post.countDocuments({ auteur: userId, createdAt: { $gte: today } })
                return count >= 1 ? { ok: true } : { ok: false, reason: "Tu n'as pas encore publié d'actualité aujourd'hui." }
            }
            case "use_ai": {
                const count = await Message.countDocuments({ expediteur: userId, contenu: { $regex: /^\/[a-z+]/i }, createdAt: { $gte: today } })
                return count >= 1 ? { ok: true } : { ok: false, reason: "Tu n'as pas encore utilisé de commande IA aujourd'hui." }
            }
            case "send_5_msgs": {
                const count = await Message.countDocuments({ expediteur: userId, createdAt: { $gte: today } })
                return count >= 5 ? { ok: true } : { ok: false, reason: `Tu as envoyé ${count}/5 messages aujourd'hui.` }
            }
            case "like_3_posts": {
                const count = await Post.countDocuments({ likes: userId })
                return count >= 3 ? { ok: true } : { ok: false, reason: `Tu as liké ${count}/3 publications.` }
            }
            case "write_2_cmts": {
                const posts = await Post.find({ "commentaires.auteur": userId })
                const count = posts.reduce((acc, p) => acc + p.commentaires.filter(c =>
                    c.auteur && c.auteur.toString() === userId && new Date(c.createdAt) >= today
                ).length, 0)
                return count >= 2 ? { ok: true } : { ok: false, reason: `Tu as écrit ${count}/2 commentaires aujourd'hui.` }
            }
            case "change_avatar":
            case "join_group":
                return { ok: true }
            default:
                return { ok: false, reason: "Type d'action inconnu." }
        }
    } catch (e) {
        return { ok: false, reason: "Erreur de vérification." }
    }
}

// Page portefeuille
router.get("/wallet", requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.user.id)
        res.render("wallet", { title: "Portefeuille", currentPage: "wallet", user, xpThresholds: XP_THRESHOLDS })
    } catch (err) { console.error(err); res.redirect("/") }
})

// Page boutique
router.get("/shop", requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.user.id)
        res.render("shop", { title: "Boutique", currentPage: "shop", user, shopItems: SHOP_ITEMS })
    } catch (err) { console.error(err); res.redirect("/") }
})

// Acheter un thème
router.post("/api/shop/buy", requireAuth, async (req, res) => {
    try {
        const { itemId } = req.body
        const user = await User.findById(req.session.user.id)
        const item = SHOP_ITEMS.find(i => i.id === itemId)
        if (!item) return res.status(404).json({ error: "Article introuvable." })
        if (user.theme === item.theme) return res.json({ success: true, message: "Thème déjà actif !" })
        if (item.price > 0 && user.role !== "admin" && user.walletBalance < item.price) {
            return res.status(402).json({ error: `Solde insuffisant (${user.walletBalance} crédits, besoin de ${item.price}).` })
        }
        if (item.price > 0 && user.role !== "admin") user.walletBalance -= item.price
        user.theme = item.theme
        await user.save()
        req.session.user.theme = item.theme
        res.json({ success: true, theme: item.theme, balance: user.walletBalance })
    } catch (err) { console.error(err); res.status(500).json({ error: "Erreur serveur." }) }
})

// Page primes
router.get("/bounties", requireAuth, async (req, res) => {
    try {
        const bounties = await Bounty.find()
            .populate("createdBy", "nom photoProfil badges")
            .populate("applicants.user", "nom photoProfil")
            .sort({ createdAt: -1 })
        const user = await User.findById(req.session.user.id)
        res.render("bounties", {
            title: "Primes",
            currentPage: "bounties",
            bounties,
            user,
            actionTypes: BOUNTY_ACTION_TYPES
        })
    } catch (err) { console.error(err); res.redirect("/") }
})

// Créer une prime
router.post("/api/bounties", requireAuth, async (req, res) => {
    try {
        const { actionType, rewardAmount } = req.body
        const user = await User.findById(req.session.user.id)
        const action = BOUNTY_ACTION_TYPES.find(a => a.id === actionType)
        if (!action) return res.status(400).json({ error: "Type d'action invalide." })
        const amount = parseInt(rewardAmount)
        if (!amount || amount < 1) return res.status(400).json({ error: "Montant minimum : 1 crédit." })
        if (user.role !== "admin" && user.walletBalance < amount) {
            return res.status(402).json({ error: `Solde insuffisant (${user.walletBalance} crédits).` })
        }
        if (user.role !== "admin") {
            user.walletBalance -= amount
            await user.save()
        }
        const bounty = await Bounty.create({
            title: action.label,
            description: action.desc,
            actionType,
            rewardAmount: amount,
            createdBy: user._id
        })
        res.json({ success: true, bounty })
    } catch (err) { console.error(err); res.status(500).json({ error: "Erreur serveur." }) }
})

// API : primes actives (pour le groupe Primes)
router.get("/api/bounties/active", requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id
        const bounties = await Bounty.find({ status: "open" })
            .populate("createdBy", "nom photoProfil")
            .sort({ createdAt: -1 })
            .limit(20)
        const withStatus = bounties.map(b => ({
            _id: b._id,
            title: b.title,
            description: b.description,
            actionType: b.actionType,
            rewardAmount: b.rewardAmount,
            creatorNom: b.createdBy?.nom,
            creatorId: b.createdBy?._id,
            applicantsCount: b.applicants.length,
            isOwn: b.createdBy?._id.toString() === userId,
            alreadyApplied: b.applicants.some(a => a.user?.toString() === userId)
        }))
        res.json({ success: true, bounties: withStatus })
    } catch (err) { res.status(500).json({ success: false, error: "Erreur serveur." }) }
})

// API : voir les candidats d'une prime
router.get("/api/bounties/:id/applicants", requireAuth, async (req, res) => {
    try {
        const bounty = await Bounty.findById(req.params.id)
            .populate("createdBy", "nom")
            .populate("applicants.user", "nom photoProfil")
        if (!bounty) return res.status(404).json({ error: "Prime introuvable." })
        if (bounty.createdBy._id.toString() !== req.session.user.id) {
            return res.status(403).json({ error: "Accès refusé." })
        }
        res.json({ success: true, applicants: bounty.applicants, bountyId: bounty._id })
    } catch (err) { res.status(500).json({ error: "Erreur serveur." }) }
})

// Accomplir une prime (auto-vérification)
router.post("/api/bounties/:id/accomplish", requireAuth, async (req, res) => {
    try {
        const bounty = await Bounty.findById(req.params.id).populate("createdBy", "_id nom")
        if (!bounty || bounty.status !== "open") {
            return res.status(400).json({ ok: false, reason: "Prime fermée ou introuvable." })
        }
        const userId = req.session.user.id
        if (bounty.createdBy._id.toString() === userId) {
            return res.status(400).json({ ok: false, reason: "Tu ne peux pas accomplir ta propre prime." })
        }
        if (bounty.applicants.some(a => a.user?.toString() === userId)) {
            return res.json({ ok: false, reason: "Tu as déjà postulé à cette prime." })
        }
        const result = await verifyBountyAction(userId, bounty.actionType, bounty.createdBy._id.toString())
        if (!result.ok) return res.json({ ok: false, reason: result.reason })

        bounty.applicants.push({ user: userId, verified: true, message: "Auto-vérifié", submittedAt: new Date() })
        bounty.status = "claimed"
        bounty.claimedBy = userId
        await bounty.save()

        const winner = await User.findById(userId)
        winner.walletBalance += bounty.rewardAmount
        winner.xp += Math.ceil(bounty.rewardAmount * 10)
        await winner.save()

        res.json({ ok: true, reward: bounty.rewardAmount, creatorNom: bounty.createdBy.nom })
    } catch (err) { console.error(err); res.status(500).json({ ok: false, reason: "Erreur serveur." }) }
})

// Attribuer manuellement une prime
router.post("/api/bounties/:id/award/:userId", requireAuth, async (req, res) => {
    try {
        const bounty = await Bounty.findById(req.params.id)
        if (!bounty) return res.status(404).json({ error: "Prime introuvable." })
        const user = await User.findById(req.session.user.id)
        if (bounty.createdBy.toString() !== req.session.user.id && user.role !== "admin") {
            return res.status(403).json({ error: "Seul le créateur ou un admin peut attribuer." })
        }
        if (bounty.status !== "open") return res.status(400).json({ error: "Prime déjà fermée." })
        const winner = await User.findById(req.params.userId)
        if (!winner) return res.status(404).json({ error: "Utilisateur introuvable." })
        winner.walletBalance += bounty.rewardAmount
        winner.xp += bounty.rewardAmount * 10
        await winner.save()
        bounty.status = "claimed"
        bounty.claimedBy = winner._id
        await bounty.save()
        res.json({ success: true, winner: winner.nom })
    } catch (err) { console.error(err); res.status(500).json({ error: "Erreur serveur." }) }
})

// Activer/désactiver le clone IA
router.post("/api/clone/toggle", requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.user.id)
        user.aiCloneActive = !user.aiCloneActive
        await user.save()
        res.json({ success: true, active: user.aiCloneActive })
    } catch (err) { res.status(500).json({ error: "Erreur serveur." }) }
})

// API solde et XP
router.get("/api/wallet/me", requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.user.id, "walletBalance xp theme role aiCloneActive")
        res.json({ balance: user.walletBalance, xp: user.xp, theme: user.theme, role: user.role, aiCloneActive: user.aiCloneActive })
    } catch (err) { res.status(500).json({ error: "Erreur serveur." }) }
})

module.exports = router
module.exports.BOUNTY_ACTION_TYPES = BOUNTY_ACTION_TYPES
