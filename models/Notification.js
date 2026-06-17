const mongoose = require("mongoose")

const notificationSchema = new mongoose.Schema({
    destinataire: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    expediteur: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    type: {
        type: String,
        enum: ["like", "commentaire", "demande_ami", "ami_accepte", "message"],
        required: true
    },
    lien: {
        type: String,
        default: "/"
    },
    lu: {
        type: Boolean,
        default: false
    }
}, { timestamps: true })

module.exports = mongoose.models.Notification || mongoose.model("Notification", notificationSchema)
