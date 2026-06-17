const mongoose = require("mongoose")

const postSchema = new mongoose.Schema({
    auteur: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    contenu: {
        type: String,
        required: true,
        maxlength: 1000
    },
    image: {
        type: String,
        default: null
    },
    likes: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    }],
    commentaires: [{
        auteur: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User"
        },
        texte: {
            type: String,
            maxlength: 300
        },
        date: {
            type: Date,
            default: Date.now
        }
    }]
}, { timestamps: true })

module.exports = mongoose.models.Post || mongoose.model("Post", postSchema)
