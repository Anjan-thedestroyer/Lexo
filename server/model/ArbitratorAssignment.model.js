import mongoose from "mongoose";

const ArbitratorAssignmentSchema = new mongoose.Schema(
  {
    caseId: {
      type: Number,
      required: true,
      index: true,
    },

    identityHash: {
      type: String,
      required: true,
      index: true,
    },

    wallet: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },

    status: {
      type: String,
      enum: ["ASSIGNED", "FINISHED"],
      default: "ASSIGNED",
      index: true,
    },

    assignedAt: {
      type: Date,
      default: null,
    },

    finishedAt: {
      type: Date,
      default: null,
    },

    assignmentTxHash: {
      type: String,
      default: null,
    },

    finishTxHash: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

ArbitratorAssignmentSchema.index(
  { caseId: 1, wallet: 1 },
  { unique: true }
);

const ArbitratorAssignmentModel = mongoose.model(
  "ArbitratorAssignment",
  ArbitratorAssignmentSchema
);

export default ArbitratorAssignmentModel;