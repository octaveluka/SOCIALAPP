const express = require("express")
const router = express.Router()
const User = require("../models/User")
const Notification = require("../models/Notification")
const { requireAuth } = require("../middleware/auth")

// Page Amis — demandes reçues + liste d'amis
router.get("/friends", requireAuth, async (req, res) => {
    try {
        const currentUser = await User.findById(req.session.user.id)
            .populate("amis", "nom photoProfil bio")
            .populate("demandesRecues", "nom photoProfil bio")
            .populate("demandesEnvoyees", "nom photoProfil bio")

        const demandesCount = currentUser.demandesRecues.length

        res.render("friends", {
            title: "Amis",
            currentPage: "friends",
            amis: currentUser.amis,
            demandesRecues: currentUser.demandesRecues,
            demandesEnvoyees: currentUser.demandesEnvoyees,
            demandesCount
        })
    } catch (err) {
        console.error(err)
        res.redirect("/")
    }
})

// Recherche d'utilisateurs + suggestions par défaut
router.get("/search", requireAuth, async (req, res) => {
    try {
        const { q } = req.query
        const currentUser = await User.findById(req.session.user.id)

        let resultats = []
        let suggestions = []

        if (q && q.trim().length > 0) {
            resultats = await User.find({
                nom: { $regex: q.trim(), $options: "i" },
                _id: { $ne: currentUser._id }
            }).limit(20)
        } else {
            suggestions = await User.find({ _id: { $ne: currentUser._id } })
                .sort({ createdAt: -1 })
                .limit(10)
        }

        const demandesCount = currentUser.demandesRecues.length

        res.render("search", {
            title: "Rechercher",
            currentPage: "search",
            resultats,
            suggestions,
            query: q || "",
            currentUser,
            demandesCount
        })
    } catch (err) {
        console.error(err)
        res.redirect("/")
    }
})

// Envoyer une demande d'ami
router.post("/friends/request/:id", requireAuth, async (req, res) => {
    try {
        const targetId = req.params.id
        const currentUser = await User.findById(req.session.user.id)
        const targetUser = await User.findById(targetId)

        if (!targetUser) {
            req.flash("error", "Utilisateur introuvable.")
            return res.redirect("/")
        }

        if (targetId === currentUser._id.toString()) {
            return res.redirect("/")
        }

        const alreadyFriend = currentUser.amis.some(id => id.toString() === targetId)
        const alreadySent = currentUser.demandesEnvoyees.some(id => id.toString() === targetId)

        if (alreadyFriend || alreadySent) {
            return res.redirect(req.headers.referer || "/")
        }

        currentUser.demandesEnvoyees.push(targetId)
        targetUser.demandesRecues.push(currentUser._id)

        await currentUser.save()
        await targetUser.save()

        const notification = await Notification.create({
            destinataire: targetUser._id,
            expediteur: currentUser._id,
            type: "demande_ami",
            lien: "/friends"
        })

        // Émettre la notification en temps réel
        if (global.io) {
            global.io.emit('notification', notification)
        }

        req.flash("success", "Demande d'ami envoyée !")
        res.redirect(req.headers.referer || "/")
    } catch (err) {
        console.error(err)
        res.redirect("/")
    }
})

// Annuler une demande envoyée
router.post("/friends/cancel/:id", requireAuth, async (req, res) => {
    try {
        const targetId = req.params.id
        const currentUser = await User.findById(req.session.user.id)
        const targetUser = await User.findById(targetId)

        if (!targetUser) return res.redirect("/")

        currentUser.demandesEnvoyees = currentUser.demandesEnvoyees.filter(
            id => id.toString() !== targetId
        )
        targetUser.demandesRecues = targetUser.demandesRecues.filter(
            id => id.toString() !== currentUser._id.toString()
        )

        await currentUser.save()
        await targetUser.save()

        req.flash("success", "Demande annulée.")
        res.redirect(req.headers.referer || "/")
    } catch (err) {
        console.error(err)
        res.redirect("/")
    }
})

// Accepter une demande
router.post("/friends/accept/:id", requireAuth, async (req, res) => {
    try {
        const targetId = req.params.id
        const currentUser = await User.findById(req.session.user.id)
        const targetUser = await User.findById(targetId)

        if (!targetUser) return res.redirect("/")

        const hasRequest = currentUser.demandesRecues.some(id => id.toString() === targetId)
        if (!hasRequest) {
            return res.redirect(req.headers.referer || "/")
        }

        currentUser.demandesRecues = currentUser.demandesRecues.filter(
            id => id.toString() !== targetId
        )
        targetUser.demandesEnvoyees = targetUser.demandesEnvoyees.filter(
            id => id.toString() !== currentUser._id.toString()
        )

        currentUser.amis.push(targetId)
        targetUser.amis.push(currentUser._id)

        await currentUser.save()
        await targetUser.save()

        const notification = await Notification.create({
            destinataire: targetUser._id,
            expediteur: currentUser._id,
            type: "ami_accepte",
            lien: "/profile/" + currentUser._id
        })

        // Émettre la notification en temps réel
        if (global.io) {
            global.io.emit('notification', notification)
        }

        req.flash("success", `Vous êtes maintenant ami avec ${targetUser.nom} !`)
        res.redirect(req.headers.referer || "/friends")
    } catch (err) {
        console.error(err)
        res.redirect("/")
    }
})

// Refuser une demande
router.post("/friends/decline/:id", requireAuth, async (req, res) => {
    try {
        const targetId = req.params.id
        const currentUser = await User.findById(req.session.user.id)
        const targetUser = await User.findById(targetId)

        currentUser.demandesRecues = currentUser.demandesRecues.filter(
            id => id.toString() !== targetId
        )

        if (targetUser) {
            targetUser.demandesEnvoyees = targetUser.demandesEnvoyees.filter(
                id => id.toString() !== currentUser._id.toString()
            )
            await targetUser.save()
        }

        await currentUser.save()

        req.flash("success", "Demande refusée.")
        res.redirect(req.headers.referer || "/friends")
    } catch (err) {
        console.error(err)
        res.redirect("/")
    }
})

// Retirer un ami
router.post("/friends/remove/:id", requireAuth, async (req, res) => {
    try {
        const targetId = req.params.id
        const currentUser = await User.findById(req.session.user.id)
        const targetUser = await User.findById(targetId)

        currentUser.amis = currentUser.amis.filter(id => id.toString() !== targetId)

        if (targetUser) {
            targetUser.amis = targetUser.amis.filter(
                id => id.toString() !== currentUser._id.toString()
            )
            await targetUser.save()
        }

        await currentUser.save()

        req.flash("success", "Ami retiré.")
        res.redirect(req.headers.referer || "/friends")
    } catch (err) {
        console.error(err)
        res.redirect("/")
    }
})

module.exports = router
