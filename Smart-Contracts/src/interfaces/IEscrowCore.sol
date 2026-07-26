//SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IEscrowCore{
     function resolveDispute(
        uint256 _dealId,
        uint256 _payerAmount,
        uint256 _payeeAmount
    ) external ;
    
}