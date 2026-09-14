import mongoose from "mongoose";

const AgreementSchema = new mongoose.Schema(
    {
        contractAddress: {
            type: String,
            default: null,
        },
        dealId:{
            type: mongoose.Schema.Types.ObjectId,
            ref: "Escrow",
            default: null,
        },
        contentHash: {
            type: String,
            required: true,
        },

        contentLink: {
            type: String,
            required: true,
        },

        payerSigned: {
            type: Boolean,
            default: false,
        },

        payeeSigned: {
            type: Boolean,
            default: false,
        },

        payer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        payee: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        status: {
            type: String,
            enum: [
                "DRAFT",
                "PENDING_SIGNATURE",
                "SIGNED",
                "ACTIVE",
                "COMPLETED",
                "CANCELLED",
            ],
            default: "DRAFT",
        },
    },
    {
        timestamps: true,
    }
);

const AgreementModel = mongoose.model("Agreement", AgreementSchema);

export default AgreementModel;