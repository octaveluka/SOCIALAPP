const express = require("express")
const router = express.Router()
const bcrypt = require("bcryptjs")
const { requireAuth } = require("../middleware/auth")
const User = require("../models/User")
const SubProfile = require("../models/SubProfile")

// =============================================
// GHOST TYPING (Incognito Input)
// =============================================
router.post("/api/settings/incognito-input", requireAuth, async (req, res) => {
    try {
        const { enabled } = req.body
        const user = await User.findById(req.session.user.id)
        user.isIncognitoInput = !!enabled
        await user.save()
        req.session.user.isIncognitoInput = user.isIncognitoInput
        res.json({ success: true, isIncognitoInput: user.isIncognitoInput })
    } catch (err) {
        res.status(500).json({ error: "Erreur serveur." })
    }
})

// =============================================
// COFFRE-FORT (PIN par conversation)
// =============================================

// Verrouiller / définir PIN pour une conv
router.post("/api/vault/lock/:otherId", requireAuth, async (req, res) => {
    try {
        const { pin } = req.body
        if (!pin || pin.length < 4) return res.status(400).json({ error: "PIN de 4 chiffres minimum." })
        const user = await User.findById(req.session.user.id)
        const hashedPin = await bcrypt.hash(pin, 10)
        user.vaultedChats.set(req.params.otherId, hashedPin)
        await user.save()
        res.json({ success: true, message: "Conversation verrouillée." })
    } catch (err) {
        res.status(500).json({ error: "Erreur serveur." })
    }
})

// Déverrouiller une conv (vérifier PIN)
router.post("/api/vault/unlock/:otherId", requireAuth, async (req, res) => {
    try {
        const { pin } = req.body
        const user = await User.findById(req.session.user.id)
        const hashedPin = user.vaultedChats.get(req.params.otherId)
        if (!hashedPin) return res.json({ success: true, locked: false })
        const match = await bcrypt.compare(pin, hashedPin)
        if (!match) return res.status(403).json({ error: "PIN incorrect." })
        res.json({ success: true, unlocked: true })
    } catch (err) {
        res.status(500).json({ error: "Erreur serveur." })
    }
})

// Supprimer le verrou
router.delete("/api/vault/lock/:otherId", requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.user.id)
        user.vaultedChats.delete(req.params.otherId)
        await user.save()
        res.json({ success: true })
    } catch (err) {
        res.status(500).json({ error: "Erreur serveur." })
    }
})

// Vérifier si une conv est verrouillée
router.get("/api/vault/status/:otherId", requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.user.id)
        const locked = user.vaultedChats.has(req.params.otherId)
        res.json({ locked })
    } catch (err) {
        res.status(500).json({ error: "Erreur serveur." })
    }
})

// =============================================
// SOUS-PROFILS ANONYMES
// =============================================

// Créer un sous-profil
router.post("/api/subprofiles", requireAuth, async (req, res) => {
    try {
        const generated = SubProfile.generateAnonymous()
        const sub = await SubProfile.create({
            userId: req.session.user.id,
            anonymousUsername: generated.name,
            anonymousAvatarUrl: generated.avatar
        })
        res.json({ success: true, subProfile: sub })
    } catch (err) {
        res.status(500).json({ error: "Erreur serveur." })
    }
})

// Lister mes sous-profils
router.get("/api/subprofiles", requireAuth, async (req, res) => {
    try {
        const subs = await SubProfile.find({ userId: req.session.user.id })
        res.json({ subProfiles: subs })
    } catch (err) {
        res.status(500).json({ error: "Erreur serveur." })
    }
})

// Activer / désactiver un sous-profil
router.post("/api/subprofiles/:id/activate", requireAuth, async (req, res) => {
    try {
        const sub = await SubProfile.findOne({ _id: req.params.id, userId: req.session.user.id })
        if (!sub) return res.status(404).json({ error: "Sous-profil introuvable." })
        const user = await User.findById(req.session.user.id)
        if (user.activeSubProfile?.toString() === sub._id.toString()) {
            user.activeSubProfile = null
            await user.save()
            return res.json({ success: true, active: false, message: "Mode anonyme désactivé." })
        }
        user.activeSubProfile = sub._id
        await user.save()
        res.json({ success: true, active: true, subProfile: sub })
    } catch (err) {
        res.status(500).json({ error: "Erreur serveur." })
    }
})

// Supprimer un sous-profil
router.delete("/api/subprofiles/:id", requireAuth, async (req, res) => {
    try {
        await SubProfile.deleteOne({ _id: req.params.id, userId: req.session.user.id })
        const user = await User.findById(req.session.user.id)
        if (user.activeSubProfile?.toString() === req.params.id) {
            user.activeSubProfile = null
            await user.save()
        }
        res.json({ success: true })
    } catch (err) {
        res.status(500).json({ error: "Erreur serveur." })
    }
})

module.exports = router
