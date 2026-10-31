
import mongoose from "mongoose";

const PayeeReqSchema = new mongoose.Schema(
    {
        agreementId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Agreement",
            required: true,
        },

        dealId: {
            type: Number,
            required: true,
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
        payeeAddress:{
            type: String,
            required : true
        },

        documentHash: {
            type: String,
            required: true,
        },

        payerContentLink: {
            type: String,
            required: true,
        },

        payeeContentLink: {
            type: String,
            default: null,
        },

        status: {
            type: String,
            enum: ["PENDING", "ACCEPTED", "REJECTED"],
            default: "PENDING",
        },

        txHash: {
            type: String,
            default: null,
        },
    },
    { timestamps: true }
);

const PayeeReqModel = mongoose.model("PayeeReq", PayeeReqSchema);

export default PayeeReqModel;
