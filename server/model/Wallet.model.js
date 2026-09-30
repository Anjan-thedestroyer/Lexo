import mongoose from "mongoose";

const walletSchema = new mongoose.Schema(
  {
    address: {
      type: String,
      required: [true, "Provide wallet address"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    status: {
      type: String,
      enum: ["Active", "Inactive", "Removed"],
      default: "Active",
    },

    linkedAt: {
      type: Date,
      default: Date.now,
    },

    removedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const WalletModel = mongoose.model("Wallet", walletSchema);

export default WalletModel;