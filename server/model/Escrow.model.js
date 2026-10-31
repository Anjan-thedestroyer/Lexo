import mongoose from "mongoose";

const MilestoneSchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: true,
            trim: true,
        },

        description: {
            type: String,
            default: "",
        },

        amount: {
            type: String,
            required: true,
        },

        dueDate: {
            type: Date,
            default: null,
        },

        status: {
            type: String,
            enum: [
                "PENDING",
                "SUBMITTED",
                "APPROVED",
                "RELEASED",
                "DISPUTED",
            ],
            default: "PENDING",
        },

        evidence: {
            type: String,
            default: null,
        },

        submittedAt: {
            type: Date,
            default: null,
        },

        approvedAt: {
            type: Date,
            default: null,
        },

        releasedAt: {
            type: Date,
            default: null,
        },
    },
    {
        _id: true,
    }
);

const EscrowSchema = new mongoose.Schema(
    {
        agreement: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Agreement",
            default: null,
        },

        dealId:{
            type: Number,

        },

        payer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        payee: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },

        totalAmount: {
            type: String,
            required: true,
        },

        token: {
            type: String,
            default: "USDT",
        },

        status: {
            type: String,
            enum: [
                "CREATED",
                "BOTH_SIGNED",
                "COMPLETED",
                "DISPUTED",
                "REFUNDED",
                "CANCELLED",
            ],
            default: "CREATED",
        },

        milestones: {
            type: [MilestoneSchema],
            default: [],
        },

        dispute: {
            status: {
                type: String,
                enum: ["NONE", "OPEN", "RESOLVED"],
                default: "NONE",
            },

            reason: {
                type: String,
                default: null,
            },

            openedBy: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User",
                default: null,
            },

            openedAt: {
                type: Date,
                default: null,
            },

            resolvedAt: {
                type: Date,
                default: null,
            },
        },

        transactions: {
            funded: {
                type: String,
                default: null,
            },

            released: {
                type: String,
                default: null,
            },

            refunded: {
                type: String,
                default: null,
            },
        },
    },
    {
        timestamps: true,
    }
);

const EscrowModel = mongoose.model("Escrow", EscrowSchema);

export default EscrowModel;