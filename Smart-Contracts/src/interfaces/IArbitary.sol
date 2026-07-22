//License-Identifier: MIT
//SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IArbitary {
    function resolveDispute(uint256 dealId, uint8 milestoneIndex, bool releaseToPayee) external;
    function createCase(uint256 dealId, string calldata reason) external;
}   