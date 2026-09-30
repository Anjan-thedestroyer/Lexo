import mongoose from "mongoose";

const ArbitratorSchema = new mongoose.Schema(
  {
    identityHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    wallet: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },

    unstakeRequestedAt: {
      type: Date,
      default: null,
    },

    active: {
      type: Boolean,
      default: false,
      index: true,
    },

    suspended: {
      type: Boolean,
      default: false,
      index: true,
    },

    stake: {
      type: String,
      default: "0",
    },

    activeCases: {
      type: Number,
      default: 0,
    },

    reputation: {
      type: Number,
      default: 0,
    },

    // Useful for frontend/admin filtering
    eligible: {
      type: Boolean,
      default: false,
      index: true,
    },

    transactions: {
      added: {
        type: String,
        default: null,
      },

      stakeIncreased: {
        type: String,
        default: null,
      },

      unstakeRequested: {
        type: String,
        default: null,
      },

      unstakeCompleted: {
        type: String,
        default: null,
      },

      walletChanged: {
        type: String,
        default: null,
      },

      statusChanged: {
        type: String,
        default: null,
      },
    },
  },
  {
    timestamps: true,
  }
);

const ArbitratorModel = mongoose.model(
  "Arbitrator",
  ArbitratorSchema
);

export default ArbitratorModel;