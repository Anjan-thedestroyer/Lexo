// ============================================================
// TYPES
// ============================================================

export interface IdentitySignals {
  nationality: string;
  ageAbove17: boolean;
  passportExpired: boolean;
  authLevel: string;
  isHighRiskJurisdiction: boolean;
}

export interface WalletSignals {
  amlScore: number | null;
  sanctions: boolean;
  pep: boolean;
  fraud: boolean;
  walletRisk: number | null;
  mixerExposure: boolean;
  highRiskWallet: boolean;
  transactionRisk: number | null;
  isHighRiskJurisdiction: boolean;
}

export interface RiskResult {
  score: number;
  tier: "LOW" | "MEDIUM" | "HIGH";
}


// ============================================================
// HIGH-RISK JURISDICTIONS
// ============================================================

const HIGH_RISK_JURISDICTIONS = new Set([
  "KP",
  "IR",
  "MM",
]);


// ============================================================
// IDENTITY SIGNALS
// ============================================================

export function normalizeIdentitySignals(
  input: Record<string, any>
): IdentitySignals {

  const rawNationality =
    input.nationality ||
    input.citizenship ||
    "UNKNOWN";

  const nationality =
    String(rawNationality)
      .toUpperCase()
      .trim();

  return {
    nationality,

    ageAbove17:
      typeof input.ageAbove17 === "boolean"
        ? input.ageAbove17
        : false,

    passportExpired:
      typeof input.passportExpired === "boolean"
        ? input.passportExpired
        : false,

    authLevel:
      typeof input.authLevel === "string"
        ? input.authLevel.toUpperCase().trim()
        : "UNKNOWN",

    isHighRiskJurisdiction:
      HIGH_RISK_JURISDICTIONS.has(
        nationality
      ),
  };
}


// ============================================================
// IDENTITY RISK ENGINE
// ============================================================

export function runIdentityRuleEngine(
  signals: IdentitySignals
): RiskResult {

  let score = 10;

  // Underage
  if (!signals.ageAbove17) {
    score += 90;
  }

  // Expired passport
  if (signals.passportExpired) {
    score += 80;
  }

  // High-risk jurisdiction
  if (signals.isHighRiskJurisdiction) {
    score += 60;
  }

  // Verification assurance level
  if (signals.authLevel !== "AA") {
    score += 20;
  }

  return buildRiskResult(score);
}


// ============================================================
// WALLET SIGNALS
// ============================================================

export function normalizeWalletSignals(
  input: Record<string, any>
): WalletSignals {

  return {
    amlScore:
      typeof input.amlScore === "number"
        ? input.amlScore
        : null,

    sanctions:
      Boolean(input.sanctions),

    pep:
      Boolean(input.pep),

    fraud:
      Boolean(input.fraud),

    walletRisk:
      typeof input.walletRisk === "number"
        ? input.walletRisk
        : null,

    mixerExposure:
      Boolean(input.mixerExposure),

    highRiskWallet:
      Boolean(input.highRiskWallet),

    transactionRisk:
      typeof input.transactionRisk === "number"
        ? input.transactionRisk
        : null,

    isHighRiskJurisdiction:
      Boolean(input.isHighRiskJurisdiction),
  };
}


// ============================================================
// WALLET RISK ENGINE
// ============================================================

export function runWalletRuleEngine(
  signals: WalletSignals
): RiskResult {

  let score = 10;

  // Sanctions
  if (signals.sanctions) {
    score += 90;
  }

  // Fraud
  if (signals.fraud) {
    score += 80;
  }

  // High-risk wallet
  if (signals.highRiskWallet) {
    score += 60;
  }

  // Mixer exposure
  if (signals.mixerExposure) {
    score += 60;
  }

  // PEP
  if (signals.pep) {
    score += 30;
  }

  // High-risk jurisdiction
  if (signals.isHighRiskJurisdiction) {
    score += 40;
  }

  // Wallet risk
  if (
    signals.walletRisk !== null &&
    signals.walletRisk >= 70
  ) {
    score += 40;
  }

  // Transaction risk
  if (
    signals.transactionRisk !== null &&
    signals.transactionRisk >= 70
  ) {
    score += 40;
  }

  // AML score
  if (
    signals.amlScore !== null &&
    signals.amlScore >= 70
  ) {
    score += 40;
  }

  return buildRiskResult(score);
}


// ============================================================
// BUILD RISK RESULT
// ============================================================

function buildRiskResult(
  score: number
): RiskResult {

  const normalizedScore =
    Math.min(score, 100);

  let tier: "LOW" | "MEDIUM" | "HIGH";

  if (normalizedScore >= 70) {
    tier = "HIGH";
  } else if (normalizedScore >= 40) {
    tier = "MEDIUM";
  } else {
    tier = "LOW";
  }

  return {
    score: normalizedScore,
    tier,
  };
}


// ============================================================
// DECISION ENGINE
// ============================================================

export function decisionEngine(
  tier: "LOW" | "MEDIUM" | "HIGH"
): "APPROVE" | "REJECT" {

  return tier === "HIGH"
    ? "REJECT"
    : "APPROVE";
}