// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract IdentityRegister is Ownable {
    address public verifier;
    uint256 public immutable MAX_WALLET = 5;
    
    mapping(bytes32 => address[]) public identityToWallets;
    mapping(address => bytes32) public walletToIdentity;
    mapping(bytes32 => bool) public restricted;
    mapping(bytes32 => bool) public verified;
    mapping(bytes32 => uint256) public walletsNumbers;

    event Verified(bytes32 indexed hash, address indexed walletAddress);
    event VerifierChanged(address indexed newVerifier);
    event Unverified(bytes32 indexed hash);
    event WalletsAdded(bytes32 indexed hash, address[] wallets);
    event IdentityRestricted(bytes32 indexed hash, bool isRestricted);
    event WalletRemoved(bytes32 indexed hash, address indexed wallet);


    error NotVerifier();
    error WalletNotLinkedToIdentity();
    error CannotRemoveLastWallet();
    error NotAuthorizedIdentityOwner();
    error WalletAlreadyLinked();
    error MaximumWalletCreated();

    constructor() Ownable(msg.sender) {}

    modifier onlyVerifier() {
        if (msg.sender != verifier) {
            revert NotVerifier();
        }
        _;
    }

    function addVerifier(address _verifierAddress) external onlyOwner {
        verifier = _verifierAddress;
        emit VerifierChanged(_verifierAddress);
    }

    function verify(bytes32 _hash, address _wallet) public onlyVerifier {
        // conditional check (revert if wallet IS already linked)
        if (walletToIdentity[_wallet] != bytes32(0)) {
            revert WalletAlreadyLinked();
        }
        
        // Ensure verifying a fresh identity does not bypass limits
        if (walletsNumbers[_hash] >= MAX_WALLET) {
            revert MaximumWalletCreated();
        }

        identityToWallets[_hash].push(_wallet);
        walletToIdentity[_wallet] = _hash;
        walletsNumbers[_hash] += 1;
        verified[_hash] = true;
        
        emit Verified(_hash, _wallet);
    }

    function addWallets(address[] calldata _wallets, bytes32 _hash) external {
        require(!restricted[_hash], "Identity restricted");
        if (walletToIdentity[msg.sender] != _hash || !verified[_hash]) {
            revert NotAuthorizedIdentityOwner();
        }

        // Validate total potential length safely outside the loop
        uint256 currentCount = walletsNumbers[_hash];
        if (currentCount + _wallets.length > MAX_WALLET) {
            revert MaximumWalletCreated();
        }

        for (uint256 i = 0; i < _wallets.length; i++) {
            address targetWallet = _wallets[i];
            
            if (walletToIdentity[targetWallet] != bytes32(0)) {
                revert WalletAlreadyLinked();
            }

            identityToWallets[_hash].push(targetWallet);
            walletToIdentity[targetWallet] = _hash;
        }

        walletsNumbers[_hash] = currentCount + _wallets.length;
        
        emit WalletsAdded(_hash, _wallets);
    }
    function removeWallet(bytes32 _hash, address _wallet) external {
        if ((walletToIdentity[msg.sender] != _hash || !verified[_hash]) && msg.sender != verifier) {
            revert NotAuthorizedIdentityOwner();
        }
        if (walletToIdentity[_wallet] != _hash) {
            revert WalletNotLinkedToIdentity();
        }
        if (walletsNumbers[_hash] <= 1) {
            revert CannotRemoveLastWallet();
        }
        delete walletToIdentity[_wallet];
        walletsNumbers[_hash] -= 1;

        // Clean up array element using the "swap-and-pop" method for gas efficiency
        address[] storage wallets = identityToWallets[_hash];
        uint256 length = wallets.length;
        for (uint256 i = 0; i < length; i++) {
            if (wallets[i] == _wallet) {
                wallets[i] = wallets[length - 1];
                wallets.pop();
                break;
            }
        }

        emit WalletRemoved(_hash, _wallet);
    }

    function restrict(bytes32 _hash) public onlyVerifier {
        restricted[_hash] = true;
        emit IdentityRestricted(_hash, true);
    }

    function unrestrict(bytes32 _hash) external onlyVerifier {
        restricted[_hash] = false;
        emit IdentityRestricted(_hash, false);
    }

    function isVerified(address _wallet) external view returns (bool) {
        bytes32 id = walletToIdentity[_wallet];
        return id != bytes32(0) && !restricted[id] && verified[id];
    }

    function unverify(bytes32 _hash) external onlyVerifier {
        verified[_hash] = false;
        emit Unverified(_hash);
    }

}