const mongoose = require("mongoose")

const groupSchema = new mongoose.Schema({
    nom: { type: String, required: true, trim: true, maxlength: 50 },
    photo: { type: String, default: "https://ui-avatars.com/api/?background=2563eb&color=fff&name=Groupe" },
    createur: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    membres: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        pseudo: { type: String, default: null },
        isAdmin: { type: Boolean, default: false },
        // Chaos mode override
        chaosName: { type: String, default: null },
        chaosAvatar: { type: String, default: null }
    }],
    inviteCode: { type: String, unique: true, required: true },

    // === GROUPES SYSTÈME ===
    isPermanent: { type: Boolean, default: false },
    isSystemGroup: { type: Boolean, default: false },
    systemGroupKey: { type: String, default: null }, // "avis_solutions" | "primes"

    // === CHAOS MODE ===
    isChaosMode: { type: Boolean, default: false },
    chaosExpiresAt: { type: Date, default: null },

    // === VOICE ROOM ===
    voiceRoomActive: { type: Boolean, default: false },
    voiceRoomMembers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    // === SALON ÉPHÉMÈRE ===
    isEphemeral: { type: Boolean, default: false },
    expiresAt: { type: Date, default: null },
}, { timestamps: true })

module.exports = mongoose.models.Group || mongoose.model("Group", groupSchema)
