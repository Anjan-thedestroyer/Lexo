//SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IEscrowCore{
     function resolveDispute(
        uint256 _dealId,
        uint256 _payerAmount,
        uint256 _payeeAmount
    ) external ;
    function raiseDispute(
        uint256 _dealId,
        string calldata _reason,
        bytes32 docAHash,
        bytes32 docBHash
    ) external ;
    function getDealTotalBalance(uint256 _dealId) external view returns (uint256);
}