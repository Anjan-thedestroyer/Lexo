//SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IArbitrationCourt {
    function resolveDispute(uint256 dealId, uint8 milestoneIndex, bool releaseToPayee) external;
    function createCase(uint256 dealId, string calldata reason, bytes32 evidenceHashA, bytes32 evidenceHashB) external returns(uint256 caseId);
}   