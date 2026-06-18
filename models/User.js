const mongoose = require("mongoose")
const bcrypt = require("bcryptjs")

const userSchema = new mongoose.Schema({
    nom: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    motDePasse: { type: String, required: true },
    bio: { type: String, default: "", maxlength: 200 },
    photoProfil: { type: String, default: "https://ui-avatars.com/api/?background=2563eb&color=fff&name=User" },
    amis: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    demandesRecues: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    demandesEnvoyees: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    enLigne: { type: Boolean, default: false },
    derniereConnexion: { type: Date, default: Date.now },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    isDisabled: { type: Boolean, default: false },
    badges: [{
        type: {
            type: String,
            enum: ["verifie", "moderateur", "fondateur", "premium", "staff"],
            required: true
        },
        expiresAt: { type: Date, default: null }
    }],
    isBot: { type: Boolean, default: false },
    welcomeSent: { type: Boolean, default: false },

    // === GAMIFICATION ===
    xp: { type: Number, default: 0 },
    walletBalance: { type: Number, default: 0 },
    theme: { type: String, default: "default", enum: ["default", "dark", "neon", "ocean", "sunset", "forest", "cyberpunk", "rose", "galaxie", "minuit"] },

    // === CLONE IA ===
    aiCloneActive: { type: Boolean, default: false },
    aiCloneInstructions: { type: String, default: "" },

    // === BOUTIQUE ===
    xpBoostExpiry: { type: Date, default: null },
    profileTitle: { type: String, default: null },
    profileFrame: { type: String, default: null, enum: [null, "bronze", "argent", "or", "diamant"] },

    lastFreeCredits: { type: Date, default: null },

    // === SÉCURITÉ & INCOGNITO ===
    isIncognitoInput: { type: Boolean, default: false },
    activeSubProfile: { type: mongoose.Schema.Types.ObjectId, ref: "SubProfile", default: null },
    // vaultedChats: Map<otherUserId, hashedPIN>
    vaultedChats: { type: Map, of: String, default: {} },

}, { timestamps: true })

userSchema.pre("save", async function(next) {
    if (!this.isModified("motDePasse")) return next()
    this.motDePasse = await bcrypt.hash(this.motDePasse, 10)
    next()
})

module.exports = mongoose.models.User || mongoose.model("User", userSchema)
