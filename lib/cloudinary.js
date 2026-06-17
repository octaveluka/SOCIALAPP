const cloudinary = require("cloudinary").v2
const { CloudinaryStorage } = require("multer-storage-cloudinary")
const multer = require("multer")

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
})

// =============================================
// 1. STORAGE POUR LES PHOTOS DE PROFIL
// =============================================
const profileStorage = new CloudinaryStorage({
    cloudinary,
    params: {
        folder: "socialapp/profils",
        allowed_formats: ["jpg", "jpeg", "png", "gif", "webp"],
        transformation: [{ width: 400, height: 400, crop: "fill" }]
    }
})

// =============================================
// 2. STORAGE POUR LES POSTS
// =============================================
const postStorage = new CloudinaryStorage({
    cloudinary,
    params: {
        folder: "socialapp/posts",
        allowed_formats: ["jpg", "jpeg", "png", "gif", "webp"],
        transformation: [{ width: 1200, crop: "limit" }]
    }
})

// =============================================
// 3. STORAGE POUR LES PHOTOS DE GROUPE
// =============================================
const groupStorage = new CloudinaryStorage({
    cloudinary,
    params: {
        folder: "socialapp/groupes",
        allowed_formats: ["jpg", "jpeg", "png", "gif", "webp"],
        transformation: [{ width: 400, height: 400, crop: "fill" }]
    }
})

// =============================================
// 4. STORAGE POUR LES AUDIOS (messages vocaux)
// =============================================
const audioStorage = new CloudinaryStorage({
    cloudinary,
    params: {
        folder: "socialapp/audios",
        resource_type: "video", // Cloudinary traite l'audio comme une "video" pour la compression
        allowed_formats: ["mp3", "webm", "ogg", "m4a", "aac"],
        format: "mp3", // conversion automatique en MP3 (compressé)
        transformation: [
            {
                audio_bitrate: "32k",     // très bonne compression (32 kbps)
                audio_frequency: 22050,   // 22 kHz pour limiter la taille
                quality: 50,
                fetch_format: "auto"
            }
        ],
        public_id: (req, file) => {
            const timestamp = Date.now();
            const random = Math.floor(Math.random() * 10000);
            return `audio_${timestamp}_${random}`;
        }
    }
})

// =============================================
// 5. MULTER UPLOADS
// =============================================
const uploadProfile = multer({ 
    storage: profileStorage,
    limits: { fileSize: 2 * 1024 * 1024 } // 2 Mo max pour les photos
})

const uploadPost = multer({ 
    storage: postStorage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5 Mo max pour les posts
})

const uploadGroup = multer({ 
    storage: groupStorage,
    limits: { fileSize: 2 * 1024 * 1024 } // 2 Mo max pour les groupes
})

const uploadAudio = multer({
    storage: audioStorage,
    limits: { fileSize: 1 * 1024 * 1024 } // 1 Mo max pour les audios !
})

// =============================================
// 6. EXPORT
// =============================================
module.exports = { 
    cloudinary, 
    uploadProfile, 
    uploadPost, 
    uploadGroup,
    uploadAudio,  // ← NOUVEAU : à utiliser pour les messages vocaux
    audioStorage  // ← NOUVEAU : si besoin
}
