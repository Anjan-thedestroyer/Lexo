import mongoose from "mongoose";
import AgreementModel from "../model/Agreement.model.js";
import EscrowModel from "../model/Escrow.model.js";
import PayeeReqModel from "../model/PayeeReq.model.js";

const isValidWalletAddress = (address) =>
    typeof address === "string" &&
    /^0x[a-fA-F0-9]{40}$/.test(address);

// ============================================================
// CREATE PAYEE REQUEST
// ============================================================

export async function createPayeeReq(req, res) {
    try {
        const {
            agreementId,
            dealId,
            payeeAddress,
            documentHash,
            payeeContentLink,
            txHash,
        } = req.body;

        const payeeId = req.userId;

        if (
            !agreementId ||
            dealId === undefined ||
            !payeeAddress ||
            !documentHash ||
            !payeeContentLink ||
            !txHash
        ) {
            return res.status(400).json({
                success: false,
                message: "Missing required request details.",
            });
        }

        if (!mongoose.isValidObjectId(agreementId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid agreement ID.",
            });
        }

        if (!Number.isSafeInteger(Number(dealId)) || Number(dealId) < 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid deal ID.",
            });
        }

        if (!isValidWalletAddress(payeeAddress)) {
            return res.status(400).json({
                success: false,
                message: "A valid candidate payee wallet address is required.",
            });
        }

        if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
            return res.status(400).json({
                success: false,
                message: "A valid transaction hash is required.",
            });
        }

        if (
            typeof documentHash !== "string" ||
            !/^0x[a-fA-F0-9]{64}$/.test(documentHash)
        ) {
            return res.status(400).json({
                success: false,
                message: "A valid document hash is required.",
            });
        }

        const agreement = await AgreementModel.findById(agreementId);

        if (!agreement) {
            return res.status(404).json({
                success: false,
                message: "Agreement not found.",
            });
        }

        // Agreement.dealId references the Escrow document.
        const escrow = await EscrowModel.findOne({
            _id: agreement.dealId,
            dealId: Number(dealId),
        });

        if (!escrow) {
            return res.status(400).json({
                success: false,
                message: "Deal ID does not match this agreement.",
            });
        }

        if (String(agreement.payer) === String(payeeId)) {
            return res.status(403).json({
                success: false,
                message: "The payer cannot request to become the payee.",
            });
        }

        if (agreement.payee) {
            return res.status(409).json({
                success: false,
                message: "A payee has already been selected.",
            });
        }

        if (escrow.payee) {
            return res.status(409).json({
                success: false,
                message: "A payee has already been selected for this escrow.",
            });
        }

        const existingRequest = await PayeeReqModel.findOne({
            agreementId,
            payee: payeeId,
            status: "PENDING",
        });

        if (existingRequest) {
            return res.status(409).json({
                success: false,
                message: "You already have a pending request.",
            });
        }

        const payerContentLink =
            agreement.payerContentLink || agreement.contentLink;

        if (!payerContentLink) {
            return res.status(400).json({
                success: false,
                message: "Payer document URL is missing from the agreement.",
            });
        }

        const request = await PayeeReqModel.create({
            agreementId,
            dealId: Number(dealId),
            payer: agreement.payer,
            payee: payeeId,

            // Store the exact wallet that will be used in the contract call.
            payeeAddress,

            documentHash,
            payerContentLink,
            payeeContentLink,
            txHash,
            status: "PENDING",
        });

        return res.status(201).json({
            success: true,
            message: "Payee request created successfully.",
            data: request,
        });
    } catch (error) {
        console.error("Create payee request:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to create payee request.",
        });
    }
}

// ============================================================
// ACCEPT PAYEE REQUEST
// Call after the frontend confirms the acceptance transaction.
// ============================================================

export async function acceptPayeeReq(req, res) {
    try {
        const { requestId, txHash } = req.body;

        if (!mongoose.isValidObjectId(requestId)) {
            return res.status(400).json({
                success: false,
                message: "Valid request ID is required.",
            });
        }

        if (!/^0x[a-fA-F0-9]{64}$/.test(txHash || "")) {
            return res.status(400).json({
                success: false,
                message: "A valid transaction hash is required.",
            });
        }

        const request = await PayeeReqModel.findOne({
            _id: requestId,
            payer: req.userId,
            status: "PENDING",
        });

        if (!request) {
            return res.status(404).json({
                success: false,
                message: "Pending payee request not found.",
            });
        }

        if (!isValidWalletAddress(request.payeeAddress)) {
            return res.status(400).json({
                success: false,
                message: "The request has no valid candidate payee wallet address.",
            });
        }

        const agreement = await AgreementModel.findOne({
            _id: request.agreementId,
            payer: req.userId,
            payee: null,
        });

        if (!agreement) {
            return res.status(409).json({
                success: false,
                message: "Agreement already has a payee or is unavailable.",
            });
        }

        const escrow = await EscrowModel.findOne({
            _id: agreement.dealId,
            dealId: request.dealId,
            payer: req.userId,
            status: "CREATED",
            payee: null,
        });

        if (!escrow) {
            return res.status(409).json({
                success: false,
                message: "Escrow is unavailable or already has a payee.",
            });
        }

        // Update the agreement.
        agreement.payee = request.payee;
        agreement.payeeAddress = request.payeeAddress;
        agreement.payeeContentLink = request.payeeContentLink;
        agreement.payeeContentHash = request.documentHash;
        await agreement.save();

        // Update the escrow.
        escrow.payee = request.payee;
        escrow.status = "BOTH_SIGNED";
        await escrow.save();

        request.status = "ACCEPTED";
        request.txHash = txHash;
        await request.save();

        // Reject other pending requests for the same agreement.
        await PayeeReqModel.updateMany(
            {
                agreementId: request.agreementId,
                _id: { $ne: request._id },
                status: "PENDING",
            },
            {
                $set: { status: "REJECTED" },
            },
        );

        return res.status(200).json({
            success: true,
            message: "Payee request accepted and agreement updated.",
            data: {
                request,
                agreement,
                escrow,
            },
        });
    } catch (error) {
        console.error("Accept payee request:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to accept payee request.",
        });
    }
}

// ============================================================
// REJECT PAYEE REQUEST
// Call after the frontend confirms the rejection transaction.
// ============================================================

export async function rejectPayeeReq(req, res) {
    try {
        const { requestId, txHash } = req.body;

        if (!mongoose.isValidObjectId(requestId)) {
            return res.status(400).json({
                success: false,
                message: "Valid request ID is required.",
            });
        }

        if (!/^0x[a-fA-F0-9]{64}$/.test(txHash || "")) {
            return res.status(400).json({
                success: false,
                message: "A valid transaction hash is required.",
            });
        }

        const request = await PayeeReqModel.findOneAndUpdate(
            {
                _id: requestId,
                payer: req.userId,
                status: "PENDING",
            },
            {
                $set: {
                    status: "REJECTED",
                    txHash,
                },
            },
            { new: true },
        );

        if (!request) {
            return res.status(409).json({
                success: false,
                message: "Pending payee request not found or already processed.",
            });
        }

        return res.status(200).json({
            success: true,
            message: "Payee request rejected.",
            data: request,
        });
    } catch (error) {
        console.error("Reject payee request:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to reject payee request.",
        });
    }
}

// ============================================================
// GET PAYEE REQUESTS FOR THE LOGGED-IN PAYER
// ============================================================

export async function getPayeeRequestsByUserId(req, res) {
    try {
        const userId = req.userId || req.user?._id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized.",
            });
        }

        // The payer needs to see requests submitted by candidate payees.
        const requests = await PayeeReqModel.find({
            payer: userId,
            status: "PENDING",
        })
            .populate("payer", "name email")
            .populate("payee", "name email")
            .sort({ createdAt: -1 })
            .lean();

        if (requests.length === 0) {
            return res.status(200).json({
                success: true,
                data: [],
            });
        }

        const agreementIds = [
            ...new Set(requests.map((request) => String(request.agreementId))),
        ];

        const agreements = await AgreementModel.find({
            _id: { $in: agreementIds },
        })
            .select(
                "payer payee payerContentLink payeeContentLink status payerSigned payeeSigned payerAddress payeeAddress dealId",
            )
            .lean();

        const agreementsById = new Map(
            agreements.map((agreement) => [
                String(agreement._id),
                agreement,
            ]),
        );

        const escrowIds = [
            ...new Set(
                agreements
                    .map((agreement) => agreement.dealId)
                    .filter(Boolean)
                    .map(String),
            ),
        ];

        const escrows = await EscrowModel.find({
            _id: { $in: escrowIds },
            status: "CREATED",
        })
            .populate("payer", "name email")
            .lean();

        const escrowsById = new Map(
            escrows.map((escrow) => [String(escrow._id), escrow]),
        );

        const data = requests.map((request) => {
            const agreement = agreementsById.get(
                String(request.agreementId),
            );

            const escrow = agreement
                ? escrowsById.get(String(agreement.dealId))
                : null;

            return {
                ...request,
                agreement: agreement || null,
                escrow: escrow || null,

                // This is the candidate wallet used by the contract call.
                payeeAddress: request.payeeAddress,
            };
        });

        return res.status(200).json({
            success: true,
            data,
        });
    } catch (error) {
        console.error("getPayeeRequestsByUserId error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch payee requests.",
        });
    }
}