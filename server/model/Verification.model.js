import mongoose from "mongoose";

const verificationSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        passport: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Passport",
            required: true,
        },

        eventId: {
            type: String,
            default: null,
            index: true,
        },

        nullifier: {
            type: String,
            default: null,
            index: true,
        },

        status: {
            type: String,
            enum: [
                "PROCESSING",
                "MANUAL_REVIEW",
                "VERIFIED",
                "REJECTED",
            ],
            default: "PROCESSING",
        },

        score: {
            type: Number,
            default: null,
        },

        tier: {
            type: String,
            enum: ["LOW", "MEDIUM", "HIGH", null],
            default: null,
        },

        reasons: {
            type: [String], 
            default: [],
        },

        llmExplanation: {
            type: String,
            default: null,
        },

        decision: {
            type: String,
            enum: [
                "APPROVE",
                "MANUAL_REVIEW",
                "REJECT",
                null,
            ],
            default: null,
        },

        shouldIssueAttestation: {
            type: Boolean,
            default: false,
        },

        attestationTxHash: {
            type: String,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

const Verification = mongoose.model(
    "Verification",
    verificationSchema
);

export default Verification;
