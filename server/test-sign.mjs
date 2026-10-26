import { ethers } from "ethers";
import { recoverAddress } from "viem";

const digest =
  "0x43581ffe2831e746e5ea2633cc371c7c1d61c386311f7398278acad2cfaaf13c";

const signature =
  "0xee559368384c9d7cfd26ad4816a0ae1a835febe04c44ca2cb794027fcd4dd2d012a1f3d98656d23b0bb2e35cba8082b4ab05bdc19c3e648e40bfe9fa8ebff4bc1c";

const expectedVerifier =
  "0xb745E488D1F2BECb5DcF0404BCDc325093B62F59";

async function main() {
  // 1. Recover the signer from the existing signature
  const recovered = await recoverAddress({
    hash: digest,
    signature,
  });

  console.log("Recovered signer:", recovered);
  console.log(
    "Signature matches verifier:",
    recovered.toLowerCase() === expectedVerifier.toLowerCase()
  );

  // 2. Check the backend private key against the on-chain verifier
  const RPC_URL = process.env.RPC_URL;
  const CONTRACT_ADDRESS = process.env.IDENTITY_REGISTER_ADDRESS;
  const PRIVATE_KEY = process.env.CRE_VERIFIER_PRIVATE_KEY;

  if (!RPC_URL || !CONTRACT_ADDRESS || !PRIVATE_KEY) {
    throw new Error("Missing RPC_URL, IDENTITY_REGISTER_ADDRESS, or PRIVATE_KEY");
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);

  const abi = [
    "function verifier() view returns (address)",
  ];

  const contract = new ethers.Contract(
    CONTRACT_ADDRESS,
    abi,
    provider
  );

  const onChainVerifier = await contract.verifier();

  console.log("Backend signing address:", signer.address);
  console.log("On-chain verifier:", onChainVerifier);
  console.log(
    "Backend key matches verifier:",
    signer.address.toLowerCase() === onChainVerifier.toLowerCase()
  );
}

main().catch(console.error);