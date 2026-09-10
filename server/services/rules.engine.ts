export interface VerificationSignals {
  nationality: string;
  ageAbove17: boolean;
  passportExpired: boolean;
  authLevel: string;
  isHighRiskJurisdiction: boolean;
}

export interface RiskResult {
  score: number;
  tier: "LOW" | "MEDIUM" | "HIGH";
}

// FATF high-risk jurisdictions ("call for action")
const HIGH_RISK_JURISDICTIONS = new Set([
  "KP", // Democratic People's Republic of Korea
  "IR", // Iran
  "MM", // Myanmar
]);

export function normalizeSignals(
  input: Record<string, any>
): VerificationSignals {
  const rawNationality =
    input.nationality || input.citizenship || "UNKNOWN";

  const nationality = String(rawNationality)
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
      HIGH_RISK_JURISDICTIONS.has(nationality),
  };
}

export function runRuleEngine(
  signals: VerificationSignals
): RiskResult {
  let score = 10;

  // Underage rule
  if (!signals.ageAbove17) {
    score += 90;
  }

  // Expired passport rule
  if (signals.passportExpired) {
    score += 80;
  }

  // High-risk jurisdiction rule
  if (signals.isHighRiskJurisdiction) {
    score += 60;
  }

  // Verification assurance level rule
  if (signals.authLevel !== "AA") {
    score += 20;
  }

  const normalizedScore = Math.min(score, 100);

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

export function decisionEngine(
  tier: "LOW" | "MEDIUM" | "HIGH"
): "APPROVE" | "REJECT" {
  return tier === "HIGH" ? "REJECT" : "APPROVE";
}