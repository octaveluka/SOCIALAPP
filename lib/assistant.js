const User = require('../models/User');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const crypto = require('crypto');

// --- Base de connaissances ---
const KNOWLEDGE_BASE = [
    {
        keywords: ['bienvenue', 'démarrer', 'débuter', 'nouveau'],
        response: `👋 Bienvenue sur SocialApp ! Voici comment démarrer :
1. Complète ton profil (photo, bio)
2. Ajoute des amis via la recherche
3. Publie ton premier post
4. Explore les groupes de discussion
5. Consulte tes notifications

Besoin d'aide ? Pose-moi une question !`
    },
    {
        keywords: ['post', 'publier', 'publication'],
        response: `📝 Pour publier :
- Va sur la page d'accueil
- Écris ton message dans la zone "Quoi de neuf ?"
- Tu peux ajouter une image
- Clique sur "Publier"

Tu peux aussi liker et commenter les publications des autres.`
    },
    {
        keywords: ['ami', 'amis', 'ajouter', 'demande', 'recherche'],
        response: `👥 Pour ajouter des amis :
1. Va dans "Rechercher"
2. Trouve une personne
3. Clique sur "Ajouter"
4. Attends qu'elle accepte ta demande

Tu verras ses publications dans ton fil d'actualité.`
    },
    {
        keywords: ['groupe', 'groupes', 'créer', 'discussion'],
        response: `💬 Pour créer ou rejoindre un groupe :
- Créer : va dans "Groupes" → "Créer un groupe"
- Rejoindre : utilise un lien d'invitation ou demande à un admin

Dans un groupe, tu peux discuter avec plusieurs personnes en même temps.`
    },
    {
        keywords: ['message', 'messages', 'chat', 'discuter'],
        response: `💬 Pour envoyer un message :
- Va dans "Messages"
- Clique sur un contact
- Écris ton message et envoie

Tu peux aussi créer des discussions de groupe.`
    },
    {
        keywords: ['notification', 'notifications', 'alerte'],
        response: `🔔 Les notifications :
- Tu reçois une notification pour : les likes, commentaires, demandes d'ami, messages, mentions
- Le compteur s'affiche dans la navbar
- Va dans "Notifications" pour tout voir`
    },
    {
        keywords: ['profil', 'profile', 'modifier', 'bio'],
        response: `👤 Pour modifier ton profil :
- Va sur ton profil
- Clique sur "Modifier le profil"
- Tu peux changer : photo, bio, localisation, site web

N'oublie pas de sauvegarder !`
    },
    {
        keywords: ['aide', 'help', 'assistance', 'support'],
        response: `❓ Voici les commandes disponibles :
- Pose-moi une question sur une fonctionnalité
- Je peux t'expliquer comment utiliser le site

Sinon, contacte un administrateur pour de l'aide personnalisée.`
    },
    {
        keywords: ['admin', 'administrateur', 'modérateur'],
        response: `👑 Les administrateurs gèrent le site :
- Ils peuvent modérer les contenus
- Gérer les utilisateurs (activer/désactiver des comptes)
- Attribuer des badges

Si tu as un problème, contacte-les.`
    }
];

// --- Gestion du compte assistant ---
async function ensureAssistantExists() {
    const existing = await User.findOne({ isBot: true });
    if (existing) return existing;

    const bot = new User({
        nom: 'Assistant SocialApp',
        email: 'assistant@socialapp.local',
        motDePasse: crypto.randomBytes(32).toString('hex'),
        photoProfil: 'https://ui-avatars.com/api/?background=3b82f6&color=fff&name=Bot',
        bio: '🤖 Assistant officiel de SocialApp – Je réponds à toutes tes questions !',
        isBot: true,
        verified: true,
        badges: [
            { type: 'verifie' },
            { type: 'staff' }
        ]
    });

    await bot.save();
    console.log('🤖 Compte assistant créé avec succès');
    return bot;
}

// --- Trouver une réponse ---
function findResponse(message) {
    const lower = message.toLowerCase();
    for (const entry of KNOWLEDGE_BASE) {
        for (const keyword of entry.keywords) {
            if (lower.includes(keyword)) {
                return entry.response;
            }
        }
    }
    return null;
}

// --- Répondre à un utilisateur (SANS ANTI-SPAM) ---
async function replyToUser(userId, userMessage) {
    console.log('🤖 replyToUser appelé pour', userId, 'message:', userMessage);
    try {
        const assistant = await User.findOne({ isBot: true });
        if (!assistant) {
            console.log('❌ Assistant non trouvé dans replyToUser');
            return;
        }

        let response = findResponse(userMessage);
        if (!response) {
            response = `🤔 Je n'ai pas compris ta question. Voici ce que je peux faire pour toi :
- Je t'explique comment utiliser le site
- Je te donne des astuces
- Je réponds à tes questions sur les fonctionnalités

Tu peux aussi taper "!aide" pour voir la liste des commandes.`;
        }

        const message = new Message({
            expediteur: assistant._id,
            destinataire: userId,
            contenu: response,
            lu: false
        });
        await message.save();

        await Notification.create({
            destinataire: userId,
            expediteur: assistant._id,
            type: 'message',
            lien: '/messages/' + assistant._id
        });

        console.log(`✅ Assistant a répondu à ${userId}`);
    } catch (err) {
        console.error('❌ Erreur assistant (réponse) :', err.message);
    }
}

// --- Message de bienvenue (nouvel utilisateur) ---
async function sendWelcomeMessage(userId) {
    try {
        const assistant = await User.findOne({ isBot: true });
        if (!assistant) return;

        const user = await User.findById(userId);
        if (!user) return;
        if (user.welcomeSent) return;

        const welcome = `👋 Bienvenue sur SocialApp, ${user.nom} !

Je suis l'assistant officiel du site. Je suis là pour t'aider à découvrir toutes les fonctionnalités.

Pour commencer :
1. Complète ton profil (photo, bio)
2. Ajoute des amis
3. Publie ton premier post

N'hésite pas à me poser des questions, je suis là pour toi ! 🤖`;

        const message = new Message({
            expediteur: assistant._id,
            destinataire: userId,
            contenu: welcome,
            lu: false
        });
        await message.save();

        user.welcomeSent = true;
        await user.save();

        await Notification.create({
            destinataire: userId,
            expediteur: assistant._id,
            type: 'message',
            lien: '/messages/' + assistant._id
        });

        console.log(`✅ Message de bienvenue envoyé à ${user.nom}`);
    } catch (err) {
        console.error('Erreur assistant (bienvenue) :', err.message);
    }
}

// --- Campagne de bienvenue pour les anciens utilisateurs ---
async function sendWelcomeToAll() {
    try {
        const assistant = await User.findOne({ isBot: true });
        if (!assistant) {
            console.log('🤖 Assistant non trouvé, création en cours...');
            await ensureAssistantExists();
            const assistant = await User.findOne({ isBot: true });
            if (!assistant) return;
        }

        const users = await User.find({ isBot: false, welcomeSent: { $ne: true } });
        let count = 0;
        for (const user of users) {
            const welcome = `👋 Bienvenue sur SocialApp, ${user.nom} !

Je suis l'assistant officiel du site. Je suis là pour t'aider à découvrir toutes les fonctionnalités.

Pour commencer :
1. Complète ton profil (photo, bio)
2. Ajoute des amis
3. Publie ton premier post

N'hésite pas à me poser des questions, je suis là pour toi ! 🤖`;

            const message = new Message({
                expediteur: assistant._id,
                destinataire: user._id,
                contenu: welcome,
                lu: false
            });
            await message.save();

            user.welcomeSent = true;
            await user.save();
            count++;
        }
        console.log(`✅ Message de bienvenue envoyé à ${count} anciens utilisateurs`);
    } catch (err) {
        console.error('Erreur assistant (campagne bienvenue) :', err.message);
    }
}

// --- Envoyer une mise à jour à tous (avec notifications) ---
async function sendUpdateMessage(message) {
    try {
        const assistant = await User.findOne({ isBot: true });
        if (!assistant) {
            console.log('❌ Assistant non trouvé');
            return;
        }

        const users = await User.find({ isBot: false });
        console.log(`📊 ${users.length} utilisateurs trouvés pour la mise à jour`);

        let count = 0;
        for (const user of users) {
            // Créer le message
            const msg = new Message({
                expediteur: assistant._id,
                destinataire: user._id,
                contenu: `📢 Mise à jour : ${message}`,
                lu: false
            });
            await msg.save();

            // Créer une notification pour chaque utilisateur
            await Notification.create({
                destinataire: user._id,
                expediteur: assistant._id,
                type: 'message',
                lien: '/messages/' + assistant._id
            });

            count++;
        }
        console.log(`✅ Mise à jour envoyée à ${count} utilisateurs (avec notifications)`);
    } catch (err) {
        console.error('❌ Erreur assistant (mise à jour) :', err.message);
    }
}

module.exports = {
    ensureAssistantExists,
    replyToUser,
    sendWelcomeMessage,
    sendUpdateMessage,
    sendWelcomeToAll
};
