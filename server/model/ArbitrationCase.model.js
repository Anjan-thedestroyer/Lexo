import mongoose from "mongoose";

const VoteSchema = new mongoose.Schema(
  {
    arbiter: {
      type: String,
      required: true,
      lowercase: true,
    },
    choice: {
      type: Number,
      required: true,
      enum: [0, 1, 2, 3],
      // 0 = None
      // 1 = ReleaseToBuyer
      // 2 = RefundToSeller
      // 3 = Split5050
    },
    hasVoted: {
      type: Boolean,
      default: true,
    },
    txHash: {
      type: String,
      default: null,
    },
    votedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

const ArbitrationCaseSchema = new mongoose.Schema(
  {
    caseId: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },

    dealId: {
      type: Number,
      required: true,
      index: true,
    },

    parentCaseId: {
      type: Number,
      default: 0,
      index: true,
    },

    reason: {
      type: String,
      default: "",
    },

    docAHash: {
      type: String,
      default: null,
    },

    docBHash: {
      type: String,
      default: null,
    },

    arbitrationFee: {
      type: String,
      default: "0",
    },

    initiator: {
      type: String,
      required: true,
      lowercase: true,
    },

    arbiters: {
      type: [String],
      default: [],
    },

    votes: {
      type: [VoteSchema],
      default: [],
    },

    status: {
      type: String,
      enum: [
        "CREATED",
        "VOTING",
        "DECIDED",
        "EXECUTED",
        "CANCELLED",
      ],
      default: "VOTING",
      index: true,
    },

    winningChoice: {
      type: Number,
      enum: [0, 1, 2, 3],
      default: 0,
    },

    isAppeal: {
      type: Boolean,
      default: false,
    },

    appealTriggered: {
      type: Boolean,
      default: false,
    },

    createdAtChain: {
      type: Date,
      default: null,
    },

    votingDeadline: {
      type: Date,
      default: null,
    },

    decidedAt: {
      type: Date,
      default: null,
    },

    executionUnlockTime: {
      type: Date,
      default: null,
    },

    executedAt: {
      type: Date,
      default: null,
    },

    transactions: {
      created: {
        type: String,
        default: null,
      },

      recreated: {
        type: String,
        default: null,
      },

      decided: {
        type: String,
        default: null,
      },

      executed: {
        type: String,
        default: null,
      },
    },
  },
  {
    timestamps: true,
  }
);

const ArbitrationCaseModel = mongoose.model(
  "ArbitrationCase",
  ArbitrationCaseSchema
);

export default ArbitrationCaseModel;