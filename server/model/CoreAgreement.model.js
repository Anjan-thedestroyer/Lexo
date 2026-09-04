import mongoose from "mongoose";

const CoreAgreementSchema = new mongoose.Schema({
    terms:{
        type: String,
        required : true
    },
    termsDocs: {
        type: String,
        required: true
    },
    termsHash: {
        type: String,
        required: true
    },
    contractAddress: {
        type: String,
        required: true
    }
});
export const CoreAgreementModel = mongoose.model("CoreAgreement", CoreAgreementSchema);