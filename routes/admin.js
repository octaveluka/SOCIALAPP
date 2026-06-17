const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Post = require("../models/Post");
const Group = require("../models/Group");
const Message = require("../models/Message");
const { requireAdmin } = require("../middleware/auth");
const assistant = require("../lib/assistant"); // ← AJOUT

// Dashboard principal
router.get("/admin", requireAdmin, async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const totalPosts = await Post.countDocuments();
        const totalGroups = await Group.countDocuments();
        const totalMessages = await Message.countDocuments();
        const onlineUsers = await User.countDocuments({ enLigne: true });
        const disabledUsers = await User.countDocuments({ isDisabled: true });

        res.render("admin-dashboard", {
            title: "Dashboard Admin",
            currentPage: "admin",
            stats: {
                totalUsers,
                totalPosts,
                totalGroups,
                totalMessages,
                onlineUsers,
                disabledUsers
            }
        });
    } catch (err) {
        console.error(err);
        res.redirect("/");
    }
});

// === RELANCER LA CAMPAGNE DE BIENVENUE (ADMIN) ===
router.post("/admin/welcome-campaign", requireAdmin, async (req, res) => {
    try {
        await assistant.sendWelcomeToAll();
        req.flash("success", "✅ Campagne de bienvenue relancée pour tous les utilisateurs.");
    } catch (err) {
        console.error(err);
        req.flash("error", "❌ Erreur lors de l'envoi de la campagne.");
    }
    res.redirect("/admin");
});

// Liste des utilisateurs (avec recherche)
router.get("/admin/users", requireAdmin, async (req, res) => {
    try {
        const { q } = req.query;
        let filter = {};

        if (q && q.trim().length > 0) {
            filter = {
                $or: [
                    { nom: { $regex: q.trim(), $options: "i" } },
                    { email: { $regex: q.trim(), $options: "i" } }
                ]
            };
        }

        const users = await User.find(filter).sort({ createdAt: -1 });

        res.render("admin-users", {
            title: "Gestion des utilisateurs",
            currentPage: "admin",
            users,
            query: q || "",
            currentUserId: req.session.user.id
        });
    } catch (err) {
        console.error(err);
        res.redirect("/admin");
    }
});

// Activer / désactiver un compte (AJAX)
router.post("/admin/users/:id/toggle-disable", requireAdmin, async (req, res) => {
    try {
        const targetUser = await User.findById(req.params.id);
        if (!targetUser) return res.status(404).json({ error: "Utilisateur introuvable" });

        if (targetUser._id.toString() === req.session.user.id) {
            return res.status(400).json({ error: "Tu ne peux pas désactiver ton propre compte." });
        }

        targetUser.isDisabled = !targetUser.isDisabled;
        await targetUser.save();

        res.json({ success: true, isDisabled: targetUser.isDisabled });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erreur serveur" });
    }
});

// Changer le rôle (admin / user) (AJAX)
router.post("/admin/users/:id/toggle-role", requireAdmin, async (req, res) => {
    try {
        const targetUser = await User.findById(req.params.id);
        if (!targetUser) return res.status(404).json({ error: "Utilisateur introuvable" });

        if (targetUser._id.toString() === req.session.user.id) {
            return res.status(400).json({ error: "Tu ne peux pas modifier ton propre rôle." });
        }

        targetUser.role = targetUser.role === "admin" ? "user" : "admin";
        await targetUser.save();

        res.json({ success: true, role: targetUser.role });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erreur serveur" });
    }
});

// 🔵 Ajouter / retirer le badge "vérifié" (cercle bleu, sans emoji)
router.post("/admin/users/:id/toggle-verify", requireAdmin, async (req, res) => {
    try {
        const targetUser = await User.findById(req.params.id);
        if (!targetUser) return res.status(404).json({ error: "Utilisateur introuvable" });

        if (targetUser._id.toString() === req.session.user.id) {
            return res.status(400).json({ error: "Tu ne peux pas modifier ton propre statut vérifié." });
        }

        targetUser.verified = !targetUser.verified;
        await targetUser.save();

        res.json({ success: true, verified: targetUser.verified });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erreur serveur" });
    }
});

// Supprimer un compte définitivement (AJAX)
router.post("/admin/users/:id/delete", requireAdmin, async (req, res) => {
    try {
        const targetUser = await User.findById(req.params.id);
        if (!targetUser) return res.status(404).json({ error: "Utilisateur introuvable" });

        if (targetUser._id.toString() === req.session.user.id) {
            return res.status(400).json({ error: "Tu ne peux pas supprimer ton propre compte." });
        }

        await Post.deleteMany({ auteur: targetUser._id });
        await Message.deleteMany({ $or: [{ expediteur: targetUser._id }, { destinataire: targetUser._id }] });

        await User.updateMany({}, {
            $pull: {
                amis: targetUser._id,
                demandesRecues: targetUser._id,
                demandesEnvoyees: targetUser._id
            }
        });

        await User.findByIdAndDelete(targetUser._id);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erreur serveur" });
    }
});

// Ajouter un badge (AJAX)
router.post("/admin/users/:id/badges/add", requireAdmin, async (req, res) => {
    try {
        const { type } = req.body
        const types = ["verifie", "moderateur", "fondateur", "premium", "staff"]

        if (!type || !types.includes(type)) {
            return res.status(400).json({ error: "Type de badge invalide." })
        }

        const targetUser = await User.findById(req.params.id)
        if (!targetUser) return res.status(404).json({ error: "Utilisateur introuvable" })

        const alreadyHas = targetUser.badges.some(b => b.type === type)
        if (alreadyHas) {
            return res.status(400).json({ error: "Cet utilisateur a déjà ce badge." })
        }

        targetUser.badges.push({ type })
        await targetUser.save()

        res.json({ success: true, type })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: "Erreur serveur" })
    }
})

// Retirer un badge (AJAX)
router.post("/admin/users/:id/badges/remove/:type", requireAdmin, async (req, res) => {
    try {
        const targetUser = await User.findById(req.params.id)
        if (!targetUser) return res.status(404).json({ error: "Utilisateur introuvable" })

        targetUser.badges = targetUser.badges.filter(b => b.type !== req.params.type)
        await targetUser.save()

        res.json({ success: true })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: "Erreur serveur" })
    }
})

module.exports = router;
