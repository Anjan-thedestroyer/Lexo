export const CORE_AGREEMENT_ABI = [
  {
    type: "function",
    name: "signAgreement",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "hasSignedAgreement",
    stateMutability: "view",
    inputs: [
      {
        name: "_user",
        type: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
      },
    ],
  },
  {
    type: "function",
    name: "signedAt",
    stateMutability: "view",
    inputs: [
      {
        name: "",
        type: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "AlreadySigned",
    inputs: [],
  },
  {
    type: "error",
    name: "UserNotVerified",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidAddress",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidAgreementHash",
    inputs: [],
  },
] as const;