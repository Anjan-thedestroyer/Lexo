import mongoose from "mongoose";

const AgreementSchema = new mongoose.Schema(
    {
        
        dealId:{
            type: mongoose.Schema.Types.ObjectId,
            ref: "Escrow",
            default: null,
        },
        payerContentHash: {
            type: String,
            required: true,
        },

        payerContentLink: {
            type: String,
            required: true,
        },
        
        payeeContentLink:{
            type: String,
            default: null
        },
        payeeContentHash: {
            type: String,
            default: null,
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
            default: null,
        },

        payerAddress : {
            type : String,
            required : true
        },
        payeeAddress : {
            type : String,
        },
        invitePayee:[{
            type:String,
        }],

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