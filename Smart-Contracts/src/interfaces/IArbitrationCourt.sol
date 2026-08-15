//SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IArbitrationCourt {
    function resolveDispute(uint256 dealId, uint8 milestoneIndex, bool releaseToPayee) external;
    function createCase(uint256 dealId, string calldata reason, bytes32 evidenceHashA, bytes32 evidenceHashB, uint256 rewardAmount) external returns(uint256 caseId);
    function recreateCase(uint256 _parentCaseId, string calldata _appealReason) external returns(uint256 caseId);
}   