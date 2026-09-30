import countryRiskData from "./countryRisk.json" with { type: "json" };

export type CountryRiskLevel =
  | "LOW"
  | "MODERATE"
  | "HIGH"
  | "VERY_HIGH";

export interface CountryRiskReason {
  code: string;
  description: string;
  points: number;
  source: string;
  sourceUrl: string;
}

export interface CountryRiskEntry {
  countryCode: string;
  country: string;
  score: number;
  level: CountryRiskLevel;
  reasons: CountryRiskReason[];
  sources: unknown[];
  lastUpdated: string;
  policyVersion: string;
}

export interface CountryRiskResult {
  countryCode: string;
  country: string | null;
  score: number;
  level: CountryRiskLevel;
  reasons: CountryRiskReason[];
  policyVersion: string;
  found: boolean;
}

const countries = countryRiskData.countries as CountryRiskEntry[];

const countryRiskMap = new Map<string, CountryRiskEntry>(
  countries.map((country) => [
    country.countryCode.toUpperCase(),
    country,
  ])
);


export function getCountryRisk(
  countryCode: string | null | undefined
): CountryRiskResult {
  const code = countryCode?.trim().toUpperCase();

  if (!code) {
    return {
      countryCode: "",
      country: null,
      score: 0,
      level: "LOW",
      reasons: [],
      policyVersion: countryRiskData.meta.policyVersion,
      found: false,
    };
  }

  const entry = countryRiskMap.get(code);

  if (!entry) {
    return {
      countryCode: code,
      country: null,
      score: 0,
      level: "LOW",
      reasons: [],
      policyVersion: countryRiskData.meta.policyVersion,
      found: false,
    };
  }

  return {
    countryCode: entry.countryCode,
    country: entry.country,
    score: entry.score,
    level: entry.level,
    reasons: entry.reasons,
    policyVersion: entry.policyVersion,
    found: true,
  };
}
