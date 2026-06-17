const express = require("express");
const router = express.Router();
const Message = require("../models/Message");
const User = require("../models/User");
const Group = require("../models/Group");
const { requireAuth } = require("../middleware/auth");
const { uploadAudio, uploadPost } = require("../lib/cloudinary");

// Liste des conversations
router.get("/messages", requireAuth, async (req, res) => {
    try {
        const currentUserId = req.session.user.id;
        const messages = await Message.find({
            $or: [{ expediteur: currentUserId }, { destinataire: currentUserId }],
            groupe: null
        }).sort({ createdAt: -1 });

        const partnerIds = [];
        messages.forEach(m => {
            if (!m.destinataire) return;
            const other = m.expediteur.toString() === currentUserId
                ? m.destinataire.toString()
                : m.expediteur.toString();
            if (!partnerIds.includes(other)) partnerIds.push(other);
        });

        const conversations = [];
        for (const id of partnerIds) {
            const partner = await User.findById(id);
            if (!partner) continue;
            const lastMsg = messages.find(m =>
                m.destinataire && (m.expediteur.toString() === id || m.destinataire.toString() === id)
            );
            const unreadCount = await Message.countDocuments({ expediteur: id, destinataire: currentUserId, lu: false });
            const currentUser2 = await User.findById(currentUserId);
            const locked = currentUser2.vaultedChats?.has(id) || false;
            conversations.push({ partner, lastMsg, unreadCount, locked });
        }

        const currentUser = await User.findById(currentUserId).populate("amis", "nom photoProfil enLigne");
        const groupes = await Group.find({ "membres.user": currentUserId });

        res.render("messages", {
            title: "Messages",
            currentPage: "messages",
            conversations,
            amis: currentUser.amis,
            groupes,
            currentUserId
        });
    } catch (err) {
        console.error(err);
        res.redirect("/");
    }
});

// Conversation avec un utilisateur
router.get("/messages/:id", requireAuth, async (req, res) => {
    try {
        const currentUserId = req.session.user.id;
        const otherId = req.params.id;
        const otherUser = await User.findById(otherId);
        if (!otherUser) {
            req.flash("error", "Utilisateur introuvable.");
            return res.redirect("/messages");
        }

        const messages = await Message.find({
            groupe: null,
            $or: [
                { expediteur: currentUserId, destinataire: otherId },
                { expediteur: otherId, destinataire: currentUserId }
            ]
        }).populate("repondA").sort({ createdAt: 1 });

        await Message.updateMany(
            { expediteur: otherId, destinataire: currentUserId, lu: false },
            { lu: true }
        );

        const currentUser = await User.findById(currentUserId);
        const isLocked = currentUser.vaultedChats?.has(otherId) || false;

        res.render("chat", {
            title: otherUser.nom,
            currentPage: "messages",
            otherUser,
            messages,
            currentUserId,
            isLocked,
            isIncognito: currentUser.isIncognitoInput || false
        });
    } catch (err) {
        console.error(err);
        res.redirect("/messages");
    }
});

// Supprimer un message (soft delete)
router.post("/api/messages/:id/delete", requireAuth, async (req, res) => {
    try {
        const msg = await Message.findById(req.params.id);
        if (!msg) return res.status(404).json({ error: "Message introuvable." });
        if (msg.expediteur.toString() !== req.session.user.id) {
            return res.status(403).json({ error: "Tu ne peux supprimer que tes propres messages." });
        }
        msg.isDeleted = true;
        msg.contenu = "";
        await msg.save();

        if (global.io) {
            const room = msg.destinataire ? msg.destinataire.toString() : "group_" + msg.groupe;
            const senderId = msg.expediteur.toString();
            const event = msg.groupe ? "group-message-deleted" : "message-deleted";
            global.io.to(room).emit(event, { messageId: msg._id });
            global.io.to(senderId).emit(event, { messageId: msg._id });
        }
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erreur serveur." });
    }
});

// Réactions en Ib (messages privés)
router.post("/api/messages/:id/react", requireAuth, async (req, res) => {
    try {
        const { emoji } = req.body;
        const userId = req.session.user.id;
        const msg = await Message.findById(req.params.id);
        if (!msg) return res.status(404).json({ error: "Message introuvable." });

        // Retirer réaction existante de cet user
        msg.reactions = msg.reactions.filter(r => r.user.toString() !== userId);
        if (emoji) msg.reactions.push({ user: userId, emoji });
        await msg.save();

        if (global.io) {
            const otherId = msg.expediteur.toString() === userId
                ? msg.destinataire?.toString()
                : msg.expediteur.toString();
            if (otherId) {
                global.io.to(otherId).emit("message-reacted-ib", { messageId: msg._id, reactions: msg.reactions });
                global.io.to(userId).emit("message-reacted-ib", { messageId: msg._id, reactions: msg.reactions });
            }
        }
        res.json({ success: true, reactions: msg.reactions });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erreur serveur." });
    }
});

// Envoyer un message vocal
router.post("/messages/audio", requireAuth, uploadAudio.single("audio"), async (req, res) => {
    try {
        const { to, groupId, duration } = req.body;
        const currentUserId = req.session.user.id;
        if (!req.file) return res.status(400).json({ error: "Aucun fichier audio envoyé." });
        if (!to && !groupId) return res.status(400).json({ error: "Destinataire ou groupe requis." });

        const newMessage = new Message({
            expediteur: currentUserId,
            destinataire: to || null,
            groupe: groupId || null,
            audio: req.file.path,
            duration: duration || null,
            lu: false
        });
        await newMessage.save();

        // XP pour message envoyé
        await User.findByIdAndUpdate(currentUserId, { $inc: { xp: 1 } });

        const expediteur = await User.findById(currentUserId);
        const payload = {
            _id: newMessage._id,
            expediteur: currentUserId,
            destinataire: to,
            groupe: groupId,
            audio: req.file.path,
            duration: duration || null,
            contenu: "",
            lu: false,
            createdAt: newMessage.createdAt,
            expediteurNom: expediteur.nom,
            expediteurPhoto: expediteur.photoProfil
        };

        if (global.io) {
            if (to) {
                global.io.to(to).emit("new-message", payload);
                global.io.to(currentUserId).emit("new-message", payload);
            } else if (groupId) {
                global.io.to("group_" + groupId).emit("new-group-message", payload);
            }
        }
        res.json({ success: true, message: payload });
    } catch (err) {
        console.error("Erreur upload audio:", err);
        res.status(500).json({ error: err.message || "Erreur lors de l'envoi du message vocal." });
    }
});

// Envoyer une photo
router.post("/messages/photo", requireAuth, uploadPost.single("image"), async (req, res) => {
    try {
        const { to, groupId } = req.body;
        const currentUserId = req.session.user.id;
        if (!req.file) return res.status(400).json({ error: "Aucune image envoyée." });
        if (!to && !groupId) return res.status(400).json({ error: "Destinataire ou groupe requis." });

        const newMessage = new Message({
            expediteur: currentUserId,
            destinataire: to || null,
            groupe: groupId || null,
            image: req.file.path,
            lu: false
        });
        await newMessage.save();

        const expediteur = await User.findById(currentUserId);
        const payload = {
            _id: newMessage._id,
            expediteur: currentUserId,
            destinataire: to,
            groupe: groupId,
            image: req.file.path,
            contenu: "",
            lu: false,
            createdAt: newMessage.createdAt,
            expediteurNom: expediteur.nom,
            expediteurPhoto: expediteur.photoProfil
        };

        if (global.io) {
            if (to) {
                global.io.to(to).emit("new-message", payload);
                global.io.to(currentUserId).emit("new-message", payload);
            } else if (groupId) {
                global.io.to("group_" + groupId).emit("new-group-message", payload);
            }
        }
        res.json({ success: true, message: payload });
    } catch (err) {
        console.error("Erreur upload photo:", err);
        res.status(500).json({ error: err.message || "Erreur lors de l'envoi de l'image." });
    }
});

module.exports = router;
