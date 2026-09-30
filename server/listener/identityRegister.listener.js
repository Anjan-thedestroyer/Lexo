import { ethers } from "ethers";

import UserModel from "../model/user.model.js";
import WalletModel from "../model/Wallet.model.js";
import Verification from "../model/Verification.model.js";
import PassportModel from "../model/passport.model.js";

import IdentityRegisterABI from "../abi/IdentityRegister.json"
    with { type: "json" };


// ============================================================
// CONFIG
// ============================================================

const RPC_URL = process.env.RPC_URL;

const IDENTITY_REGISTER_ADDRESS =
    process.env.IDENTITY_REGISTER_ADDRESS;

if (!RPC_URL) {
    throw new Error(
        "RPC_URL is not configured"
    );
}

if (!IDENTITY_REGISTER_ADDRESS) {
    throw new Error(
        "IDENTITY_REGISTER_ADDRESS is not configured"
    );
}

const provider =
    new ethers.JsonRpcProvider(
        RPC_URL
    );

const identityRegister =
    new ethers.Contract(
        IDENTITY_REGISTER_ADDRESS,
        IdentityRegisterABI,
        provider
    );


function getEventId(event) {
    if (!event) return null;

    return `${event.log.transactionHash}-${event.log.index}`;
}
async function findVerification(identityHash) {
    return Verification.findOne({
        nullifier: identityHash,
    }).sort({
        createdAt: -1,
    });
}

async function handleIdentityRegistered(
    identityHash,
    rootWallet,
    event
) {
    const eventId =
        getEventId(event);

    const normalizedWallet =
        rootWallet.toLowerCase();

    console.log(
        `IdentityRegistered: ${identityHash} -> ${normalizedWallet}`
    );

    // ----------------------------------------------------------
    // Find verification
    // ----------------------------------------------------------

    const verification =
        await findVerification(
            identityHash
        );

    if (!verification) {
        console.error(
            `No verification found for identity ${identityHash}`
        );

        return;
    }

    const user =
        await UserModel.findById(
            verification.user
        );

    if (!user) {
        console.error(
            `User not found for verification ${verification._id}`
        );

        return;
    }

    // ----------------------------------------------------------
    // Check if wallet already exists
    // ----------------------------------------------------------

    let wallet =
        await WalletModel.findOne({
            address: normalizedWallet,
        });

    // ----------------------------------------------------------
    // Create root wallet
    // ----------------------------------------------------------

    if (!wallet) {
        wallet =
            await WalletModel.create({
                address:
                    normalizedWallet,

                user:
                    user._id,

                status:
                    "Active",

                linkedAt:
                    new Date(),
            });

        console.log(
            `Root wallet created: ${wallet._id}`
        );
    }

    // ----------------------------------------------------------
    // Add wallet to user.wallets
    // ----------------------------------------------------------

    const alreadyInUser =
        user.wallets?.some(
            (walletId) =>
                walletId.toString() ===
                wallet._id.toString()
        );

    if (!alreadyInUser) {
        user.wallets.push(
            wallet._id
        );
    }

    // ----------------------------------------------------------
    // Set root wallet
    // ----------------------------------------------------------

    user.rootWallet =
        wallet._id;

    // Blockchain is now the source of truth
    user.identityVerification =
        "VERIFIED";

    user.eventId =
        eventId;

    await user.save();

    // ----------------------------------------------------------
    // Update passport
    // ----------------------------------------------------------

    if (user.passport) {
        await PassportModel.findByIdAndUpdate(
            user.passport,
            {
                status: "Approved",
            }
        );
    }

    // ----------------------------------------------------------
    // Store blockchain event ID
    // ----------------------------------------------------------

    await Verification.findByIdAndUpdate(
        verification._id,
        {
            eventId,
            attestationTxHash:
                event.log.transactionHash,
        }
    );

    console.log(
        `Identity ${identityHash} synchronized successfully`
    );
}


// ============================================================
// 2. WALLET LINKED
// ============================================================

async function handleWalletLinked(
    identityHash,
    walletAddress,
    isRoot,
    event
) {
    const eventId =
        getEventId(event);

    const normalizedWallet =
        walletAddress.toLowerCase();

    console.log(
        `WalletLinked: ${normalizedWallet} -> ${identityHash}`
    );

    // ----------------------------------------------------------
    // Find identity verification
    // ----------------------------------------------------------

    const verification =
        await findVerification(
            identityHash
        );

    if (!verification) {
        console.error(
            `No verification found for identity ${identityHash}`
        );

        return;
    }

    // ----------------------------------------------------------
    // Find user
    // ----------------------------------------------------------

    const user =
        await UserModel.findById(
            verification.user
        );

    if (!user) {
        console.error(
            `User not found for identity ${identityHash}`
        );

        return;
    }

    // ----------------------------------------------------------
    // Find/create wallet
    // ----------------------------------------------------------

    let wallet =
        await WalletModel.findOne({
            address: normalizedWallet,
        });

    if (!wallet) {
        wallet =
            await WalletModel.create({
                address:
                    normalizedWallet,

                user:
                    user._id,

                status:
                    "Active",

                linkedAt:
                    new Date(),
            });

        console.log(
            `Wallet created: ${normalizedWallet}`
        );
    } else if (
        wallet.status !== "Active"
    ) {
        wallet.status =
            "Active";

        wallet.removedAt =
            null;

        wallet.linkedAt =
            new Date();

        await wallet.save();
    }

    // ----------------------------------------------------------
    // Add wallet to user's wallet list
    // ----------------------------------------------------------

    const alreadyLinked =
        user.wallets?.some(
            (walletId) =>
                walletId.toString() ===
                wallet._id.toString()
        );

    if (!alreadyLinked) {
        user.wallets.push(
            wallet._id
        );
    }

    // ----------------------------------------------------------
    // If event says this is root wallet
    // ----------------------------------------------------------

    if (isRoot) {
        user.rootWallet =
            wallet._id;
    }

    user.eventId =
        eventId;

    await user.save();

    console.log(
        `Wallet ${normalizedWallet} synchronized`
    );
}

async function handleWalletRemoved(
    identityHash,
    walletAddress,
    event
) {
    const eventId =
        getEventId(event);

    const normalizedWallet =
        walletAddress.toLowerCase();

    console.log(
        `WalletRemoved: ${normalizedWallet}`
    );

    // ----------------------------------------------------------
    // Find wallet
    // ----------------------------------------------------------

    const wallet =
        await WalletModel.findOne({
            address: normalizedWallet,
        });

    if (!wallet) {
        console.log(
            `Wallet ${normalizedWallet} does not exist in MongoDB`
        );

        return;
    }

    // ----------------------------------------------------------
    // Mark wallet removed
    // ----------------------------------------------------------

    wallet.status =
        "Removed";

    wallet.removedAt =
        new Date();

    await wallet.save();
    const user =
        await UserModel.findById(
            wallet.user
        );

    if (!user) {
        console.error(
            `User not found for wallet ${normalizedWallet}`
        );

        return;
    }

    user.wallets =
        user.wallets.filter(
            (walletId) =>
                walletId.toString() !==
                wallet._id.toString()
        );

    user.eventId =
        eventId;

    await user.save();

    console.log(
        `Wallet ${normalizedWallet} marked as removed`
    );
}

async function handleUnverified(
    identityHash,
    event
) {
    const eventId =
        getEventId(event);

    console.log(
        `Unverified: ${identityHash}`
    );

    const verification =
        await findVerification(
            identityHash
        );

    if (!verification) {
        console.error(
            `No verification found for ${identityHash}`
        );

        return;
    }

    // ----------------------------------------------------------
    // Find user
    // ----------------------------------------------------------

    const user =
        await UserModel.findById(
            verification.user
        );

    if (user) {
        user.identityVerification =
            "NOT_VERIFIED";

        user.eventId =
            eventId;

        await user.save();
    }

    // ----------------------------------------------------------
    // Mark verification as no longer verified
    // ----------------------------------------------------------

    await Verification.findByIdAndUpdate(
        verification._id,
        {
            status: "REJECTED",
            shouldIssueAttestation: false,
            eventId,
        }
    );

    // ----------------------------------------------------------
    // Update passport
    // ----------------------------------------------------------

    if (verification.passport) {
        await PassportModel.findByIdAndUpdate(
            verification.passport,
            {
                status: "Rejected",
            }
        );
    }

    // ----------------------------------------------------------
    // Mark all wallets inactive/removed
    // ----------------------------------------------------------

    const wallets =
        await WalletModel.find({
            user: verification.user,
        });

    for (const wallet of wallets) {
        wallet.status =
            "Removed";

        wallet.removedAt =
            new Date();

        await wallet.save();
    }

    if (user) {
        user.wallets = [];
        user.rootWallet = null;

        await user.save();
    }

    console.log(
        `Identity ${identityHash} marked unverified`
    );
}


// ============================================================
// 5. IDENTITY RESTRICTED
// ============================================================

async function handleIdentityRestricted(
    identityHash,
    isRestricted,
    event
) {
    const eventId =
        getEventId(event);

    console.log(
        `IdentityRestricted: ${identityHash} = ${isRestricted}`
    );

    const verification =
        await findVerification(
            identityHash
        );

    if (!verification) {
        console.error(
            `No verification found for ${identityHash}`
        );

        return;
    }

    // ----------------------------------------------------------
    // IMPORTANT
    // ----------------------------------------------------------
    //
    // We do NOT change identityVerification to REJECTED.
    //
    // "Restricted" is different from "Rejected".
    // The blockchain remains the source of truth.
    //
    // If you want MongoDB to persist this state,
    // add an identityRestricted boolean to User.
    // ----------------------------------------------------------

    await Verification.findByIdAndUpdate(
        verification._id,
        {
            eventId,
        }
    );

    console.log(
        `Restriction state synchronized for ${identityHash}`
    );
}


// ============================================================
// 6. ROOT WALLET CHANGED
// ============================================================

async function handleRootWalletChanged(
    identityHash,
    newRootWallet,
    event
) {
    const eventId =
        getEventId(event);

    const normalizedWallet =
        newRootWallet.toLowerCase();

    console.log(
        `RootWalletChanged: ${identityHash} -> ${normalizedWallet}`
    );

    // ----------------------------------------------------------
    // Find identity
    // ----------------------------------------------------------

    const verification =
        await findVerification(
            identityHash
        );

    if (!verification) {
        console.error(
            `No verification found for ${identityHash}`
        );

        return;
    }

    // ----------------------------------------------------------
    // Find new root wallet
    // ----------------------------------------------------------

    const wallet =
        await WalletModel.findOne({
            address: normalizedWallet,
        });

    if (!wallet) {
        console.error(
            `New root wallet ${normalizedWallet} not found in MongoDB`
        );

        return;
    }

    // ----------------------------------------------------------
    // Update user
    // ----------------------------------------------------------

    const user =
        await UserModel.findById(
            verification.user
        );

    if (!user) {
        console.error(
            `User not found for ${identityHash}`
        );

        return;
    }

    user.rootWallet =
        wallet._id;

    user.eventId =
        eventId;

    await user.save();

    console.log(
        `Root wallet updated to ${normalizedWallet}`
    );
}


// ============================================================
// 7. VERIFIER CHANGED
// ============================================================

async function handleVerifierChanged(
    newVerifier,
    event
) {
    console.log(
        `VerifierChanged: ${newVerifier}`
    );

    console.log(
        `Transaction: ${event.log.transactionHash}`
    );

    // No MongoDB update is required.
    //
    // The verifier is blockchain configuration,
    // not user data.
}


// ============================================================
// EVENT LISTENER
// ============================================================

export function startIdentityRegisterListener() {

    console.log(
        "Starting IdentityRegister listeners..."
    );

    // ----------------------------------------------------------
    // IdentityRegistered
    // ----------------------------------------------------------

    identityRegister.on(
        "IdentityRegistered",
        async (
            identityHash,
            rootWallet,
            event
        ) => {
            try {
                await handleIdentityRegistered(
                    identityHash,
                    rootWallet,
                    event
                );
            } catch (error) {
                console.error(
                    "IdentityRegistered listener error:",
                    error
                );
            }
        }
    );

    // ----------------------------------------------------------
    // WalletLinked
    // ----------------------------------------------------------

    identityRegister.on(
        "WalletLinked",
        async (
            identityHash,
            wallet,
            isRoot,
            event
        ) => {
            try {
                await handleWalletLinked(
                    identityHash,
                    wallet,
                    isRoot,
                    event
                );
            } catch (error) {
                console.error(
                    "WalletLinked listener error:",
                    error
                );
            }
        }
    );

    // ----------------------------------------------------------
    // WalletRemoved
    // ----------------------------------------------------------

    identityRegister.on(
        "WalletRemoved",
        async (
            identityHash,
            wallet,
            event
        ) => {
            try {
                await handleWalletRemoved(
                    identityHash,
                    wallet,
                    event
                );
            } catch (error) {
                console.error(
                    "WalletRemoved listener error:",
                    error
                );
            }
        }
    );

    // ----------------------------------------------------------
    // Unverified
    // ----------------------------------------------------------

    identityRegister.on(
        "Unverified",
        async (
            identityHash,
            event
        ) => {
            try {
                await handleUnverified(
                    identityHash,
                    event
                );
            } catch (error) {
                console.error(
                    "Unverified listener error:",
                    error
                );
            }
        }
    );

    // ----------------------------------------------------------
    // IdentityRestricted
    // ----------------------------------------------------------

    identityRegister.on(
        "IdentityRestricted",
        async (
            identityHash,
            isRestricted,
            event
        ) => {
            try {
                await handleIdentityRestricted(
                    identityHash,
                    isRestricted,
                    event
                );
            } catch (error) {
                console.error(
                    "IdentityRestricted listener error:",
                    error
                );
            }
        }
    );

    // ----------------------------------------------------------
    // RootWalletChanged
    // ----------------------------------------------------------

    identityRegister.on(
        "RootWalletChanged",
        async (
            identityHash,
            newRootWallet,
            event
        ) => {
            try {
                await handleRootWalletChanged(
                    identityHash,
                    newRootWallet,
                    event
                );
            } catch (error) {
                console.error(
                    "RootWalletChanged listener error:",
                    error
                );
            }
        }
    );

    // ----------------------------------------------------------
    // VerifierChanged
    // ----------------------------------------------------------

    identityRegister.on(
        "VerifierChanged",
        async (
            newVerifier,
            event
        ) => {
            try {
                await handleVerifierChanged(
                    newVerifier,
                    event
                );
            } catch (error) {
                console.error(
                    "VerifierChanged listener error:",
                    error
                );
            }
        }
    );

    console.log(
        "IdentityRegister listeners started successfully"
    );
}