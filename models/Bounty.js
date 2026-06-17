const mongoose = require("mongoose")

const bountySchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, required: true, maxlength: 2000 },
    rewardAmount: { type: Number, required: true, min: 1 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["open", "claimed", "closed"], default: "open" },
    claimedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    applicants: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        message: { type: String, maxlength: 500 },
        submittedAt: { type: Date, default: Date.now }
    }],
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: "Group", default: null }
}, { timestamps: true })

module.exports = mongoose.models.Bounty || mongoose.model("Bounty", bountySchema)
