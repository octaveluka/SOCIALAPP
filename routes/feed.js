const express = require("express")
const router = express.Router()
const Post = require("../models/Post")
const User = require("../models/User")
const Notification = require("../models/Notification")
const { requireAuth } = require("../middleware/auth")
const { uploadPost } = require("../lib/cloudinary")

// Page d'accueil — Feed (tous les posts, sans restriction d'amis)
router.get("/", requireAuth, async (req, res) => {
    try {
        const currentUser = await User.findById(req.session.user.id)

        // Récupère tous les posts, triés du plus récent au plus ancien
        const posts = await Post.find()
            .populate("auteur", "nom photoProfil badges")
            .populate("commentaires.auteur", "nom photoProfil badges")
            .sort({ createdAt: -1 })
            .limit(50)

        const demandesCount = currentUser.demandesRecues.length

        res.render("feed", {
            title: "Accueil",
            currentPage: "feed",
            posts,
            currentUserId: currentUser._id.toString(),
            demandesCount
        })
    } catch (err) {
        console.error(err)
        res.send("❌ Erreur lors du chargement du feed")
    }
})

// Publier un post
router.post("/post", requireAuth, uploadPost.single("image"), async (req, res) => {
    try {
        const { contenu } = req.body

        if (!contenu || contenu.trim().length === 0) {
            req.flash("error", "Le contenu ne peut pas être vide.")
            return res.redirect("/")
        }

        const newPost = new Post({
            auteur: req.session.user.id,
            contenu: contenu.trim(),
            image: req.file ? req.file.path : null
        })

        await newPost.save()
        res.redirect("/")
    } catch (err) {
        console.error(err)
        req.flash("error", "Erreur lors de la publication.")
        res.redirect("/")
    }
})

// Supprimer un post
router.post("/post/:id/delete", requireAuth, async (req, res) => {
    try {
        const post = await Post.findById(req.params.id)

        if (!post) {
            return res.redirect("/")
        }

        if (post.auteur.toString() !== req.session.user.id) {
            req.flash("error", "Tu ne peux pas supprimer ce post.")
            return res.redirect("/")
        }

        await Post.findByIdAndDelete(req.params.id)
        res.redirect("/")
    } catch (err) {
        console.error(err)
        res.redirect("/")
    }
})

// Like / Unlike un post (AJAX)
router.post("/post/:id/like", requireAuth, async (req, res) => {
    try {
        const post = await Post.findById(req.params.id)
        if (!post) return res.status(404).json({ error: "Post introuvable" })

        const userId = req.session.user.id
        const alreadyLiked = post.likes.some(id => id.toString() === userId)

        if (alreadyLiked) {
            post.likes = post.likes.filter(id => id.toString() !== userId)
        } else {
            post.likes.push(userId)

            if (post.auteur.toString() !== userId) {
                const notification = await Notification.create({
                    destinataire: post.auteur,
                    expediteur: userId,
                    type: "like",
                    lien: "/"
                })
                // Émettre la notification en temps réel
                if (global.io) {
                    global.io.emit('notification', notification)
                }
            }
        }

        await post.save()

        res.json({
            success: true,
            likesCount: post.likes.length,
            liked: !alreadyLiked
        })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: "Erreur serveur" })
    }
})

// Ajouter un commentaire (AJAX)
router.post("/post/:id/comment", requireAuth, async (req, res) => {
    try {
        const { texte } = req.body
        if (!texte || texte.trim().length === 0) {
            return res.status(400).json({ error: "Commentaire vide" })
        }

        const post = await Post.findById(req.params.id)
        if (!post) return res.status(404).json({ error: "Post introuvable" })

        post.commentaires.push({
            auteur: req.session.user.id,
            texte: texte.trim()
        })

        await post.save()

        if (post.auteur.toString() !== req.session.user.id) {
            const notification = await Notification.create({
                destinataire: post.auteur,
                expediteur: req.session.user.id,
                type: "commentaire",
                lien: "/"
            })
            // Émettre la notification en temps réel
            if (global.io) {
                global.io.emit('notification', notification)
            }
        }

        const currentUser = await User.findById(req.session.user.id)

        res.json({
            success: true,
            commentsCount: post.commentaires.length,
            comment: {
                auteur: {
                    nom: currentUser.nom,
                    photoProfil: currentUser.photoProfil
                },
                texte: texte.trim()
            }
        })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: "Erreur serveur" })
    }
})

module.exports = router
