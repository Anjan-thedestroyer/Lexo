
import mongoose from "mongoose";

const verificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    passport: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Passport",
      required: true,
    },

    eventId: {
      type: String,
      default: null,
      index: true,
    },

    nullifier: {
      type: String,
      default: null,
      index: true,
    },

    // Off-chain identity verification status
    status: {
      type: String,
      enum: [
        "PROCESSING",
        "MANUAL_REVIEW",
        "VERIFIED",
        "REJECTED",
      ],
      default: "PROCESSING",
    },

    score: {
      type: Number,
      default: null,
    },

    tier: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", null],
      default: null,
    },

    reasons: {
      type: [String],
      default: [],
    },

    llmExplanation: {
      type: String,
      default: null,
    },

    decision: {
      type: String,
      enum: ["APPROVE", "MANUAL_REVIEW", "REJECT", null],
      default: null,
    },

    shouldIssueAttestation: {
      type: Boolean,
      default: false,
    },

    // EIP-712 attestation returned by CRE
    attestationWallet: {
      type: String,
      default: null,
      lowercase: true,
    },

    attestationIdentityHash: {
      type: String,
      default: null,
    },

    attestationNonce: {
      type: String,
      default: null,
    },

    attestationDeadline: {
      type: String,
      default: null,
    },

    attestationSignature: {
      type: String,
      default: null,
    },

    // On-chain registration status
    // Off-chain identity verification status
  status: {
    type: String,
    enum: [
      "PROCESSING",
      "MANUAL_REVIEW",
      "VERIFIED",
      "REJECTED",
      "FAILED",
    ],
    default: "PROCESSING",
  },

  // On-chain registration status
  registrationStatus: {
    type: String,
    enum: [
      "NOT_SUBMITTED",
      "PENDING",
      "REGISTERED",
      "FAILED",
    ],
    default: "NOT_SUBMITTED",
  },

    // Actual on-chain transaction hash, not the EIP-712 signature
    attestationTxHash: {
      type: String,
      default: null,
    },

    amlScore: {
      type: Number,
      default: null,
    },

    countryRiskScore: {
      type: Number,
      default: null,
    },
    
  amlStatus: {
    type: String,
    enum: ["SCORED", "UNKNOWN", "INCONCLUSIVE"],
    default: "UNKNOWN",
  },

  amlRiskLevel: {
    type: String,
    default: null,
  },

  },
  {
    timestamps: true,
  }
);

const Verification = mongoose.model(
  "Verification",
  verificationSchema
);

export default Verification;
