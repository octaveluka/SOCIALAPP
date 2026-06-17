const express = require("express")
const router = express.Router()
const User = require("../models/User")
const Post = require("../models/Post")
const { requireAuth } = require("../middleware/auth")
const { nomValide } = require("../lib/validation")
const { uploadProfile } = require("../lib/cloudinary")

// Voir un profil
router.get("/profile/:id", requireAuth, async (req, res) => {
    try {
        const profileUser = await User.findById(req.params.id)
        if (!profileUser) {
            req.flash("error", "Utilisateur introuvable.")
            return res.redirect("/")
        }

        const currentUser = await User.findById(req.session.user.id)

        const posts = await Post.find({ auteur: profileUser._id })
            .populate("auteur", "nom photoProfil badges")
            .populate("commentaires.auteur", "nom photoProfil badges")
            .sort({ createdAt: -1 })

        const isOwnProfile = profileUser._id.toString() === currentUser._id.toString()
        const isFriend = currentUser.amis.some(id => id.toString() === profileUser._id.toString())
        const requestSent = currentUser.demandesEnvoyees.some(id => id.toString() === profileUser._id.toString())
        const requestReceived = currentUser.demandesRecues.some(id => id.toString() === profileUser._id.toString())

        const amisCommuns = profileUser.amis.filter(id =>
            currentUser.amis.some(myId => myId.toString() === id.toString())
        ).length

        const demandesCount = currentUser.demandesRecues.length

        res.render("profile", {
            title: profileUser.nom,
            currentPage: "profile",
            profileUser,
            posts,
            currentUserId: currentUser._id.toString(),
            isOwnProfile,
            isFriend,
            requestSent,
            requestReceived,
            amisCommuns,
            demandesCount
        })
    } catch (err) {
        console.error(err)
        req.flash("error", "Erreur lors du chargement du profil.")
        res.redirect("/")
    }
})

// Modifier le profil — page
router.get("/profile/edit/me", requireAuth, async (req, res) => {
    try {
        const currentUser = await User.findById(req.session.user.id)
        const demandesCount = currentUser.demandesRecues.length

        res.render("edit-profile", {
            title: "Modifier le profil",
            currentPage: "profile",
            profileUser: currentUser,
            demandesCount
        })
    } catch (err) {
        console.error(err)
        res.redirect("/")
    }
})

// Modifier le profil — traitement
router.post("/profile/edit", requireAuth, uploadProfile.single("photoProfil"), async (req, res) => {
    try {
        const { nom, bio } = req.body
        const currentUser = await User.findById(req.session.user.id)

        if (nom && nom.trim().length > 0) {
            if (!nomValide(nom)) {
                req.flash("error", "Le nom ne doit contenir que des lettres, chiffres, espaces, tirets ou apostrophes.")
                return res.redirect("/profile/edit/me")
            }
            currentUser.nom = nom.trim()
        }

        currentUser.bio = bio ? bio.trim() : ""

        if (req.file) {
            currentUser.photoProfil = req.file.path
        }

        await currentUser.save()

        req.session.user.nom = currentUser.nom
        req.session.user.photoProfil = currentUser.photoProfil

        req.flash("success", "Profil mis à jour avec succès !")
        res.redirect("/profile/" + currentUser._id)
    } catch (err) {
        console.error(err)
        req.flash("error", "Erreur lors de la mise à jour du profil.")
        res.redirect("/profile/edit/me")
    }
})

module.exports = router