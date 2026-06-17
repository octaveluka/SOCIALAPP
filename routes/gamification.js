const express = require("express")
const router = express.Router()
const { requireAuth } = require("../middleware/auth")
const User = require("../models/User")
const Bounty = require("../models/Bounty")

// Seuils XP pour les badges
const XP_THRESHOLDS = {
    bronze: 100,
    argent: 500,
    or: 2000,
    platine: 10000
}

const SHOP_ITEMS = [
    { id: "dark",    name: "Thème Nuit",    price: 200,  theme: "dark",    emoji: "🌙" },
    { id: "neon",    name: "Thème Néon",    price: 350,  theme: "neon",    emoji: "⚡" },
    { id: "ocean",   name: "Thème Océan",   price: 300,  theme: "ocean",   emoji: "🌊" },
    { id: "sunset",  name: "Thème Coucher", price: 300,  theme: "sunset",  emoji: "🌅" },
    { id: "forest",  name: "Thème Forêt",   price: 300,  theme: "forest",  emoji: "🌿" },
    { id: "default", name: "Thème Défaut",  price: 0,    theme: "default", emoji: "🎨" },
]

// Page portefeuille
router.get("/wallet", requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.user.id)
        res.render("wallet", {
            title: "Portefeuille",
            currentPage: "wallet",
            user,
            xpThresholds: XP_THRESHOLDS
        })
    } catch (err) {
        console.error(err)
        res.redirect("/")
    }
})

// Page boutique
router.get("/shop", requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.user.id)
        res.render("shop", {
            title: "Boutique",
            currentPage: "shop",
            user,
            shopItems: SHOP_ITEMS
        })
    } catch (err) {
        console.error(err)
        res.redirect("/")
    }
})

// Acheter un thème
router.post("/api/shop/buy", requireAuth, async (req, res) => {
    try {
        const { itemId } = req.body
        const user = await User.findById(req.session.user.id)
        const item = SHOP_ITEMS.find(i => i.id === itemId)
        if (!item) return res.status(404).json({ error: "Article introuvable." })
        if (user.theme === item.theme) return res.json({ success: true, message: "Thème déjà actif !" })
        if (item.price > 0 && user.walletBalance < item.price) {
            return res.status(402).json({ error: `Solde insuffisant (${user.walletBalance} crédits, besoin de ${item.price}).` })
        }
        if (item.price > 0) user.walletBalance -= item.price
        user.theme = item.theme
        await user.save()
        req.session.user.theme = item.theme
        res.json({ success: true, theme: item.theme, balance: user.walletBalance })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: "Erreur serveur." })
    }
})

// Page primes (bounties)
router.get("/bounties", requireAuth, async (req, res) => {
    try {
        const bounties = await Bounty.find().populate("createdBy", "nom photoProfil badges").sort({ createdAt: -1 })
        const user = await User.findById(req.session.user.id)
        res.render("bounties", {
            title: "Primes",
            currentPage: "bounties",
            bounties,
            user
        })
    } catch (err) {
        console.error(err)
        res.redirect("/")
    }
})

// Créer une prime
router.post("/api/bounties", requireAuth, async (req, res) => {
    try {
        const { title, description, rewardAmount } = req.body
        const user = await User.findById(req.session.user.id)
        const amount = parseInt(rewardAmount)
        if (!title || !description || !amount) return res.status(400).json({ error: "Champs requis manquants." })
        if (amount < 1) return res.status(400).json({ error: "Montant minimum : 1 crédit." })
        if (user.walletBalance < amount) return res.status(402).json({ error: "Solde insuffisant." })
        user.walletBalance -= amount
        await user.save()
        const bounty = await Bounty.create({ title, description, rewardAmount: amount, createdBy: user._id })
        res.json({ success: true, bounty })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: "Erreur serveur." })
    }
})

// Postuler à une prime
router.post("/api/bounties/:id/apply", requireAuth, async (req, res) => {
    try {
        const { message } = req.body
        const bounty = await Bounty.findById(req.params.id)
        if (!bounty || bounty.status !== "open") return res.status(400).json({ error: "Prime fermée ou introuvable." })
        const userId = req.session.user.id
        const alreadyApplied = bounty.applicants.some(a => a.user.toString() === userId)
        if (alreadyApplied) return res.status(400).json({ error: "Tu as déjà postulé." })
        bounty.applicants.push({ user: userId, message: message || "" })
        await bounty.save()
        res.json({ success: true })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: "Erreur serveur." })
    }
})

// Attribuer une prime à un postulant
router.post("/api/bounties/:id/award/:userId", requireAuth, async (req, res) => {
    try {
        const bounty = await Bounty.findById(req.params.id)
        if (!bounty) return res.status(404).json({ error: "Prime introuvable." })
        if (bounty.createdBy.toString() !== req.session.user.id) return res.status(403).json({ error: "Seul le créateur peut attribuer." })
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
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: "Erreur serveur." })
    }
})

// API : solde et XP de l'utilisateur courant
router.get("/api/wallet/me", requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.user.id, "walletBalance xp theme")
        res.json({ balance: user.walletBalance, xp: user.xp, theme: user.theme })
    } catch (err) {
        res.status(500).json({ error: "Erreur serveur." })
    }
})

module.exports = router
