const express = require("express")
const router = express.Router()
const bcrypt = require("bcryptjs")
const User = require("../models/User")
const Group = require("../models/Group")
const { redirectIfAuth } = require("../middleware/auth")
const { nomValide } = require("../lib/validation")
const assistant = require("../lib/assistant")
const crypto = require("crypto")

// Assurer que les groupes système existent
async function ensureSystemGroups() {
    const adminUser = await User.findOne({ role: "admin", isBot: false })
    if (!adminUser) return null

    const groups = {}

    for (const cfg of [
        { key: "avis_solutions", nom: "Avis & Solutions", emoji: "💡", desc: "Feedback, entraide et suggestions" },
        { key: "primes", nom: "Primes", emoji: "💰", desc: "Annonces et quêtes pour gagner des crédits" }
    ]) {
        let grp = await Group.findOne({ systemGroupKey: cfg.key })
        if (!grp) {
            grp = await Group.create({
                nom: cfg.nom,
                createur: adminUser._id,
                membres: [{ user: adminUser._id, isAdmin: true }],
                inviteCode: crypto.randomBytes(6).toString("hex"),
                isPermanent: true,
                isSystemGroup: true,
                systemGroupKey: cfg.key,
                photo: `https://ui-avatars.com/api/?background=4f46e5&color=fff&name=${encodeURIComponent(cfg.emoji)}&bold=true`
            })
            console.log(`✅ Groupe système créé : ${cfg.nom}`)
        }
        groups[cfg.key] = grp
    }
    return groups
}

// Ajouter un utilisateur aux groupes système
async function addUserToSystemGroups(userId) {
    try {
        const systemGroups = await Group.find({ isSystemGroup: true })
        for (const grp of systemGroups) {
            const alreadyIn = grp.membres.some(m => m.user.toString() === userId.toString())
            if (!alreadyIn) {
                grp.membres.push({ user: userId, isAdmin: false })
                await grp.save()
            }
        }
    } catch (e) {
        console.error("Erreur addUserToSystemGroups:", e.message)
    }
}

// Page de connexion
router.get("/login", redirectIfAuth, (req, res) => {
    res.render("login", { title: "Connexion" })
})

// Traitement connexion
router.post("/login", redirectIfAuth, async (req, res) => {
    try {
        const { email, motDePasse } = req.body
        const user = await User.findOne({ email: email.toLowerCase() })
        if (!user) {
            req.flash("error", "Email ou mot de passe incorrect.")
            return res.redirect("/login")
        }
        if (user.isDisabled) {
            req.flash("error", "Ce compte a été désactivé. Contacte un administrateur.")
            return res.redirect("/login")
        }
        const match = await bcrypt.compare(motDePasse, user.motDePasse)
        if (!match) {
            req.flash("error", "Email ou mot de passe incorrect.")
            return res.redirect("/login")
        }
        req.session.user = {
            id: user._id,
            nom: user.nom,
            email: user.email,
            photoProfil: user.photoProfil,
            role: user.role,
            theme: user.theme || "default",
            isIncognitoInput: user.isIncognitoInput || false
        }
        user.enLigne = true
        await user.save()
        // S'assurer que l'utilisateur est dans les groupes système
        try {
            await ensureSystemGroups()
            await addUserToSystemGroups(user._id)
        } catch(e) {}
        res.redirect("/")
    } catch (err) {
        console.error(err)
        req.flash("error", "Une erreur est survenue.")
        res.redirect("/login")
    }
})

// Page d'inscription
router.get("/register", redirectIfAuth, (req, res) => {
    res.render("register", { title: "Inscription" })
})

// Traitement inscription
router.post("/register", redirectIfAuth, async (req, res) => {
    try {
        const { nom, email, motDePasse, confirmMotDePasse } = req.body
        if (!nom || !email || !motDePasse) {
            req.flash("error", "Tous les champs sont requis.")
            return res.redirect("/register")
        }
        if (!nomValide(nom)) {
            req.flash("error", "Le nom ne doit contenir que des lettres, chiffres, espaces, tirets ou apostrophes (2 à 30 caractères).")
            return res.redirect("/register")
        }
        if (motDePasse !== confirmMotDePasse) {
            req.flash("error", "Les mots de passe ne correspondent pas.")
            return res.redirect("/register")
        }
        if (motDePasse.length < 6) {
            req.flash("error", "Le mot de passe doit contenir au moins 6 caractères.")
            return res.redirect("/register")
        }
        const existingUser = await User.findOne({ email: email.toLowerCase() })
        if (existingUser) {
            req.flash("error", "Un compte existe déjà avec cet email.")
            return res.redirect("/register")
        }
        const humanCount = await User.countDocuments({ isBot: { $ne: true } })
        const role = humanCount === 0 ? "admin" : "user"
        const newUser = new User({ nom: nom.trim(), email: email.toLowerCase(), motDePasse, role })
        await newUser.save()

        // Message de bienvenue de l'assistant
        await assistant.sendWelcomeMessage(newUser._id)

        // Assurer les groupes système et ajouter le nouvel utilisateur
        await ensureSystemGroups()
        await addUserToSystemGroups(newUser._id)

        // Crédits de bienvenue
        newUser.walletBalance = 100
        newUser.xp = 10
        await newUser.save()

        req.flash("success", "Compte créé avec succès ! Tu as reçu 100 crédits de bienvenue. Connecte-toi.")
        res.redirect("/login")
    } catch (err) {
        console.error(err)
        req.flash("error", "Une erreur est survenue.")
        res.redirect("/register")
    }
})

// Déconnexion
router.get("/logout", async (req, res) => {
    if (req.session.user) {
        try {
            const user = await User.findById(req.session.user.id)
            if (user) {
                user.enLigne = false
                user.derniereConnexion = new Date()
                await user.save()
            }
        } catch (e) {}
    }
    req.session.destroy(() => { res.redirect("/login") })
})

module.exports = router
module.exports.ensureSystemGroups = ensureSystemGroups
module.exports.addUserToSystemGroups = addUserToSystemGroups
