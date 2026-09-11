import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, "Provide name"],
            trim: true,
        },

        email: {
            type: String,
            required: [true, "Provide email"],
            unique: true,
            lowercase: true,
            trim: true,
        },

        password: {
            type: String,
            required: [true, "Provide password"],
        },

        phone: {
            type: String,
            required: [true, "Provide phone"],
            trim: true,
        },

        passport: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Passport",
            default: null,
        },

        wallets: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Wallet",
            },
        ],

        rootWallet: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Wallet",
            default: null,
        },

        identityVerification: {
            type: String,
            enum: [
                "NOT_VERIFIED",
                "REQUESTED",
                "PROCESSING",
                "MANUAL_REVIEW",
                "VERIFIED",
                "REJECTED",
            ],
            default: "NOT_VERIFIED",
        },

        eventId: {
            type: String,
            default: null,
            index: true,
        },

        status: {
            type: String,
            enum: ["Active", "Inactive", "Suspended"],
            default: "Active",
        },

        role: {
            type: String,
            enum: ["ADMIN", "USER", "ARBITRATOR"],
            default: "USER",
        },
    },
    {
        timestamps: true,
    }
);

const UserModel = mongoose.model("User", userSchema);

export default UserModel;