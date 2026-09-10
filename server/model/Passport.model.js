import mongoose from "mongoose";

const passportSchema = new mongoose.Schema(
  {
    identityHash: {
      type: String,
      required: [true, "Provide passport hash"],
      index: true,
    },

    nationality: {
      type: String,
      required: [true, "Provide nationality"],
    },

    status: {
      type: String,
      enum: [
        "Requested",
        "Processing",
        "Approved",
        "Under Manual Review",
        "Rejected",
      ],
      default: "Requested",
    },

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
  },
  {
    timestamps: true,
  }
);

const PassportModel = mongoose.model("Passport", passportSchema);

export default PassportModel;