import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Resolve __dirname equivalent in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async function deployCore(agreementHash) {
  try {
    if (!ethers.isHexString(agreementHash, 32)) {
      throw new Error(
        "Invalid agreement hash: expected a 32-byte hex string"
      );
    }

    if (!process.env.RPC_URL) {
      throw new Error("RPC_URL is not configured");
    }

    if (!process.env.PRIVATE_KEY) {
      throw new Error("PRIVATE_KEY is not configured");
    }

    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const network = await provider.getNetwork();

    console.log(`Connected to chain ID: ${network.chainId.toString()}`);

    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    console.log("Deployer:", wallet.address);

    // Dynamic Absolute Path Resolution
    // OPTION A: If your artifact is from Foundry (standard output location):
   const artifactPath = path.resolve(
      __dirname,
      "./CoreAgreement.abi.json"
    );

    // OPTION B: If your file is sitting directly in the helper directory:
    // const artifactPath = path.resolve(__dirname, "./CoreAgreement.abi.json");

    if (!fs.existsSync(artifactPath)) {
      throw new Error(`Contract artifact not found at: ${artifactPath}`);
    }

    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

    if (!artifact.abi) {
      throw new Error("Contract artifact does not contain ABI");
    }

    const bytecode = artifact.bytecode?.object || artifact.bytecode;

    if (!bytecode) {
      throw new Error("Contract bytecode is empty or missing");
    }

    // Create contract factory
    const factory = new ethers.ContractFactory(
      artifact.abi,
      bytecode,
      wallet
    );

    console.log("Deploying CoreAgreement...");
    const contract = await factory.deploy(agreementHash);

    console.log(
      "Deployment transaction:",
      contract.deploymentTransaction()?.hash
    );

    await contract.waitForDeployment();
    const contractAddress = await contract.getAddress();

    console.log("CoreAgreement deployed at:", contractAddress);

    return contractAddress;
  } catch (error) {
    console.error("CoreAgreement deployment failed:");

    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }

    throw new Error("Failed to deploy CoreAgreement");
  }
}