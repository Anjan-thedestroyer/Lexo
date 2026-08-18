// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title ICoreAgreement
 * @notice Interface for the CoreAgreement contract.
 */
interface ICoreAgreement {
    // --- Events ---

    event AgreementSigned(
        address indexed user,
        uint256 indexed timestamp
    );

    // --- Errors ---

    error UserNotVerified();
    error AlreadySigned();
    error InvalidAddress();
    error InvalidAgreementHash();

    // --- State Variable Getters ---

    function agreementHash() external view returns (bytes32);

    function publishedAt() external view returns (uint256);

    function signedAt(address user) external view returns (uint256);

    // --- External Functions ---

    function signAgreement() external;

    // --- View Functions ---

    function hasSignedAgreement(address _user) external view returns (bool);
}