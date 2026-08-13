// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IAgreementRegistry {

    function DOC_A() external view returns (uint8);

    function DOC_B() external view returns (uint8);

    function identityRegister()
        external
        view
        returns (address);
    function escrowCore()
        external
        view
        returns (address);

    function dealPayer(
        uint256 dealId
    ) external view returns (address);

    function dealPayee(
        uint256 dealId
    ) external view returns (address);


    // =========================
    // Agreement Management
    // =========================

    function setEscrowCore(
        address escrowCore
    ) external;

    function submitPayerDocument(
        uint256 dealId,
        bytes32  documentHash
    ) external;

    function submitPayeeDocument(
        uint256 dealId,
        bytes32  documentHash
    ) external;


    // =========================
    // EIP-712 Signing
    // =========================

    function signDocument(
        uint256 dealId,
        uint8 docIndex,
        bytes calldata signature
    ) external;


    // =========================
    // Verification
    // =========================

    function haveBothSigned(
        uint256 dealId
    ) external view returns (bool);

    function getDocumentStatus(
        uint256 dealId,
        uint8 docIndex
    )
        external
        view
        returns (
            bytes32 contentHash,
            bool payerSigned,
            bool payeeSigned,
            bool exists
        );

    function getSigningDigest(
        uint256 dealId,
        uint8 docIndex
    ) external view returns (bytes32);


}