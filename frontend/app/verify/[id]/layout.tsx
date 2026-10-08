"use client";

import { createContext, useContext, useState } from "react";

type VerificationData = {
  password: string;
  walletAddress: string;
  agreementSigned: boolean;
  agreementTxHash: string;
  rarimoProof: any;
  identityHash: string;
  nationality: string;
  ageAbove17: boolean;
};

type VerificationContextType = {
  verificationData: VerificationData;
  updateVerificationData: (data: Partial<VerificationData>) => void;
};

const VerificationContext = createContext<VerificationContextType | null>(null);

export function useVerification() {
  const context = useContext(VerificationContext);

  if (!context) {
    throw new Error("useVerification must be used inside VerificationProvider");
  }

  return context;
}

export default function VerifyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [verificationData, setVerificationData] = useState<VerificationData>({
    password: "",
    walletAddress: "",
    agreementSigned: false,
    agreementTxHash: "",
    rarimoProof: null,
    identityHash: "",
    nationality: "",
    ageAbove17: false,
  });

  function updateVerificationData(data: Partial<VerificationData>) {
    setVerificationData((previous) => ({
      ...previous,
      ...data,
    }));
  }

  return (
    <VerificationContext.Provider
      value={{
        verificationData,
        updateVerificationData,
      }}
    >
      {children}
    </VerificationContext.Provider>
  );
}
