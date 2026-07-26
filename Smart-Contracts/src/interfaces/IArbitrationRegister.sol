//SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IArbitrationRegister {
    function slash(address _arbitratorWallet, uint256 _amount, address _recipient) external;
    function updateReputation(address _arbitratorWallet, int256 _delta) external;
    function assignCase(address _arbitratorWallet) external;
    function finishCase(address _arbitratorWallet) external;
    function assignRandomCase(uint256 _caseId) external returns (address selected);
}