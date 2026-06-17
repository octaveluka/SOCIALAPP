const User = require("../models/User")

module.exports.requireAuth = async (req, res, next) => {
    if (!req.session.user) {
        req.flash("error", "Tu dois être connecté pour accéder à cette page !")
        return res.redirect("/login")
    }

    // Vérifier si le compte a été désactivé entre-temps
    try {
        const user = await User.findById(req.session.user.id)
        if (!user || user.isDisabled) {
            req.session.destroy(() => {})
            return res.redirect("/login")
        }
    } catch (e) {
        return res.redirect("/login")
    }

    next()
}

module.exports.redirectIfAuth = (req, res, next) => {
    if (req.session.user) {
        return res.redirect("/")
    }
    next()
}

module.exports.requireAdmin = async (req, res, next) => {
    if (!req.session.user) {
        req.flash("error", "Tu dois être connecté.")
        return res.redirect("/login")
    }

    try {
        const user = await User.findById(req.session.user.id)
        if (!user || user.role !== "admin") {
            req.flash("error", "Accès réservé aux administrateurs.")
            return res.redirect("/")
        }
        next()
    } catch (e) {
        res.redirect("/")
    }
}
