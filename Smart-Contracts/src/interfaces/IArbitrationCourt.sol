// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title IArbitrationRegister
 * @notice Interface for managing arbiter registrations, assignments, reputation, and slashing.
 */
interface IArbitrationRegister {
    // --- Events ---

    event ArbiterRegistered(address indexed arbiter);
    event ArbiterDeregistered(address indexed arbiter);
    event ArbiterSlashed(address indexed arbiter, uint256 amount, address indexed recipient);
    event ReputationUpdated(address indexed arbiter, int256 newReputation);

    // --- External / State-Changing Functions ---

    /**
     * @notice Selects and assigns a random active arbiter for a specific case.
     * @param caseId The ID of the case requiring an arbiter.
     * @return arbiter The address of the assigned arbiter.
     */
    function assignRandomCase(uint256 caseId) external returns (address arbiter);

    /**
     * @notice Directly assigns a specific arbiter to a case (e.g., during appeals).
     * @param arbiter The address of the arbiter to assign.
     */
    function assignCase(address arbiter) external;

    /**
     * @notice Decrements active case load for an arbiter when a case concludes.
     * @param arbiter The address of the arbiter finishing a case.
     */
    function finishCase(address arbiter) external;

    /**
     * @notice Updates the reputation score of an arbiter.
     * @param arbiter The address of the arbiter.
     * @param delta The positive or negative score adjustment.
     */
    function updateReputation(address arbiter, int256 delta) external;

    /**
     * @notice Slashes an arbiter's stake or collateral.
     * @param arbiter The address of the arbiter to slash.
     * @param amount The amount of tokens to slash.
     * @param recipient The address receiving the slashed tokens.
     */
    function slash(
        address arbiter,
        uint256 amount,
        address recipient
    ) external;

    // --- View Functions ---

    /**
     * @notice Checks if an address is an active registered arbiter.
     * @param arbiter The address to verify.
     * @return True if the arbiter is active.
     */
    function isArbiter(address arbiter) external view returns (bool);

    /**
     * @notice Gets current reputation score for an arbiter.
     * @param arbiter The address of the arbiter.
     * @return The numerical reputation score.
     */
    function getReputation(address arbiter) external view returns (int256);
}