// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IIdentityRegister} from "../interfaces/IIdentityRegister.sol";

contract ArbitratorRegistry is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    IIdentityRegister public immutable identityRegister;
    address public arbitrationCourt;

    uint256 public constant MINIMUM_STAKE = 500 * 1e6; // 500 USDT
    uint256 public constant UNSTAKE_COOL_DOWN = 7 days;
    uint256 public constant MAX_ACTIVE_CASES = 3;

    // --- Weighted random selection tuning ---
    // Odds per eligible arbitrator = BASE_WEIGHT + min(reputation, MAX_REPUTATION_WEIGHT)
    //                                + sqrt(stake / 1e6) * STAKE_WEIGHT_FACTOR
    // BASE_WEIGHT dominates a typical arbitrator's total weight on purpose: everyone eligible
    // keeps a real shot, reputation/stake only nudge the odds rather than deciding them outright.
    uint256 public constant BASE_WEIGHT = 100;
    uint256 public constant MAX_REPUTATION_WEIGHT = 500;
    uint256 public constant STAKE_WEIGHT_FACTOR = 2;

    struct Arbitrator {
        address wallet;             
        uint256 stake;
        uint256 activeCases;
        uint256 reputation;
        uint256 unstakeRequestedAt;
        bool active;
        bool suspended;
    }

    // identityHash => Arbitrator details
    mapping(bytes32 => Arbitrator) public arbitrators;
    
    // wallet => identityHash lookup for fast access
    mapping(address => bytes32) public arbitratorToIdentity;

    address[] public arbitratorList;
    mapping(address => uint256) private arbitratorIndex;

    // Increments on every random draw so two selections in the same block never share a seed
    uint256 public selectionNonce;

    // --- Custom Errors ---
    error Unauthorized();
    error UserNotVerified();
    error IdentityAlreadyRegistered();
    error NotRegistered();
    error NotEnoughStake();
    error InvalidAmount();
    error ActiveCasesPending();
    error UnstakeAlreadyRequested();
    error UnstakeNotRequested();
    error UnstakeCooldownActive();
    error NotEnoughEligibleArbitrators();

    // --- Events ---
    event ArbitratorAdded(bytes32 indexed identityHash, address indexed wallet, uint256 stake);
    event StakeIncreased(bytes32 indexed identityHash, address indexed wallet, uint256 addedAmount, uint256 newTotalStake);
    event UnstakeRequested(bytes32 indexed identityHash, address indexed wallet, uint256 timestamp);
    event UnstakeCompleted(bytes32 indexed identityHash, address indexed wallet, uint256 amountReturned);
    event Slashed(bytes32 indexed identityHash, address indexed wallet, uint256 amount, address indexed recipient);
    event ReputationUpdated(bytes32 indexed identityHash, uint256 newReputation);
    event CaseAssigned(bytes32 indexed identityHash, address indexed wallet, uint256 newActiveCases);
    event CaseFinished(bytes32 indexed identityHash, address indexed wallet, uint256 newActiveCases);
    event StatusChanged(bytes32 indexed identityHash, bool suspended, bool active);
    event WalletChanged(bytes32 indexed identityHash, address indexed oldWallet, address indexed newWallet);
    event ArbitratorSelected(uint256 indexed caseId, address indexed wallet, uint256 randomValue, uint256 totalWeight, uint256 poolSize);

    modifier onlyVerified(address _account) {
        if (!identityRegister.isVerified(_account)) revert UserNotVerified();
        _;
    }

    modifier onlyCourt() {
        if (msg.sender != arbitrationCourt) revert Unauthorized();
        _;
    }

    constructor(address _identityRegister, IERC20 _token) Ownable(msg.sender) {
        identityRegister = IIdentityRegister(_identityRegister);
        token = _token;
    }

    function setArbitrationCourt(address _court) external onlyOwner {
        arbitrationCourt = _court;
    }

    // --- 1. Add Arbitrator (Enforces 1 Arbitrator Per Identity) ---

    function addArbitrator(uint256 _stake) external onlyVerified(msg.sender) {
        if (msg.sender == owner()) revert Unauthorized();
        if (_stake < MINIMUM_STAKE) revert NotEnoughStake();

        // Fetch identity hash associated with caller's wallet
        bytes32 idHash = identityRegister.getIdentityHashByWallet(msg.sender);

        Arbitrator storage arb = arbitrators[idHash];
        
        // Block registration if identity is already registered under ANY wallet
        if (arb.active || arb.stake > 0) revert IdentityAlreadyRegistered();

        arb.wallet = msg.sender;
        arb.stake = _stake;
        arb.reputation = 100;
        arb.active = true;

        arbitratorToIdentity[msg.sender] = idHash;
        arbitratorIndex[msg.sender] = arbitratorList.length;
        arbitratorList.push(msg.sender);

        token.safeTransferFrom(msg.sender, address(this), _stake);
        emit ArbitratorAdded(idHash, msg.sender, _stake);
    }

    function changeWallet(address _toWallet) external onlyVerified(msg.sender) {
        if (_toWallet == address(0) || _toWallet == msg.sender) revert InvalidAmount();
        if (arbitratorToIdentity[_toWallet] != bytes32(0))revert IdentityAlreadyRegistered();

        // 1. Get identity hash of current wallet and incoming wallet
        bytes32 idHash = identityRegister.getIdentityHashByWallet(msg.sender);
        bytes32 toIdHash = identityRegister.getIdentityHashByWallet(_toWallet);

        // 2. Ensure both wallets belong to the exact same identity
        if (idHash == bytes32(0) || idHash != toIdHash) revert Unauthorized();

        Arbitrator storage arb = arbitrators[idHash];
        if (arb.wallet != msg.sender || !arb.active) revert Unauthorized();
        if (arb.activeCases > 0) revert ActiveCasesPending();

        // 3. Update reverse mappings
        delete arbitratorToIdentity[msg.sender];
        arbitratorToIdentity[_toWallet] = idHash;

        // 4. Update enumerable array indexes
        uint256 index = arbitratorIndex[msg.sender];
        arbitratorList[index] = _toWallet;
        arbitratorIndex[_toWallet] = index;
        delete arbitratorIndex[msg.sender];

        // 5. Update main state record
        arb.wallet = _toWallet;

        emit WalletChanged(idHash, msg.sender, _toWallet);
    }

    // --- 2. Increase Stake ---

    function increaseStake(uint256 _stake) external onlyVerified(msg.sender) {
        if (_stake == 0) revert InvalidAmount();
        
        bytes32 idHash = arbitratorToIdentity[msg.sender];
        Arbitrator storage arb = arbitrators[idHash];
        
        // Ensure the sender is the registered wallet for this identity
        if (!arb.active || arb.wallet != msg.sender) revert Unauthorized();
        token.safeTransferFrom(msg.sender, address(this), _stake);
        arb.stake += _stake;

        emit StakeIncreased(idHash, msg.sender, _stake, arb.stake);
    }

    // --- 3 & 4. Unstake Flow ---

    function requestUnstake() external {
        bytes32 idHash = arbitratorToIdentity[msg.sender];
        Arbitrator storage arb = arbitrators[idHash];

        if (!arb.active || arb.wallet != msg.sender) revert NotRegistered();
        if (arb.activeCases > 0) revert ActiveCasesPending();
        if (arb.unstakeRequestedAt > 0) revert UnstakeAlreadyRequested();

        arb.unstakeRequestedAt = block.timestamp;
        arb.active = false;

        emit UnstakeRequested(idHash, msg.sender, block.timestamp);
    }

    function unstake() external nonReentrant {
        bytes32 idHash = arbitratorToIdentity[msg.sender];
        Arbitrator storage arb = arbitrators[idHash];

        if (arb.wallet != msg.sender) revert Unauthorized();
        if (arb.unstakeRequestedAt == 0) revert UnstakeNotRequested();
        if (block.timestamp < arb.unstakeRequestedAt + UNSTAKE_COOL_DOWN) revert UnstakeCooldownActive();
        if (arb.activeCases > 0) revert ActiveCasesPending();

        uint256 payout = arb.stake;
        arb.stake = 0;
        arb.unstakeRequestedAt = 0;

        _removeArbitratorFromList(msg.sender, idHash);

        token.safeTransfer(msg.sender, payout);
        emit UnstakeCompleted(idHash, msg.sender, payout);
    }

    // --- 5 & 6. Slashing & Reputation (Called by Court) ---

    function slash(address _arbitratorWallet, uint256 _amount, address _recipient) external onlyCourt {
        bytes32 idHash = arbitratorToIdentity[_arbitratorWallet];
        Arbitrator storage arb = arbitrators[idHash];
        if (_amount > arb.stake) revert InvalidAmount();
        if (arb.wallet == address(0)) revert NotRegistered();

        arb.stake -= _amount;
        token.safeTransfer(_recipient, _amount);
        if(arb.stake < MINIMUM_STAKE){
            arb.suspended = true; // Auto-suspend until top-up
            emit StatusChanged(idHash, arb.suspended, arb.active);        
        }
        if(arb.reputation > 0){
            uint256 penalty = _amount / 10; // Deduct 10% of slashed amount from reputation
            arb.reputation = arb.reputation > penalty ? arb.reputation - penalty : 0;
            emit ReputationUpdated(idHash, arb.reputation);
        }

        emit Slashed(idHash, _arbitratorWallet, _amount, _recipient);
    }
    function reactivate() external {
        bytes32 idHash = arbitratorToIdentity[msg.sender];
        Arbitrator storage arb = arbitrators[idHash];
        
        if (arb.wallet != msg.sender) revert Unauthorized();
        if (arb.stake < MINIMUM_STAKE) revert NotEnoughStake();
        
        arb.suspended = false;
        emit StatusChanged(idHash, false, arb.active);
    }

    function updateReputation(address _arbitratorWallet, int256 _delta) external onlyCourt {
        bytes32 idHash = arbitratorToIdentity[_arbitratorWallet];
        Arbitrator storage arb = arbitrators[idHash];

        if (_delta < 0) {
            uint256 penalty = uint256(-_delta);
            arb.reputation = arb.reputation > penalty ? arb.reputation - penalty : 0;
        } else {
            arb.reputation += uint256(_delta);
        }
        emit ReputationUpdated(idHash, arb.reputation);
    }

    // --- 7 & 8. Case Counter Management ---

    function assignCase(address _arbitratorWallet) external onlyCourt {
        bytes32 idHash = arbitratorToIdentity[_arbitratorWallet];
        Arbitrator storage arb = arbitrators[idHash];

        if (!isEligible(_arbitratorWallet)) revert Unauthorized();
        arb.activeCases += 1;

        emit CaseAssigned(idHash, _arbitratorWallet, arb.activeCases);
    }

    function finishCase(address _arbitratorWallet) external onlyCourt {
        bytes32 idHash = arbitratorToIdentity[_arbitratorWallet];
        Arbitrator storage arb = arbitrators[idHash];

        if (arb.activeCases > 0) {
            arb.activeCases -= 1;
        }
        emit CaseFinished(idHash, _arbitratorWallet, arb.activeCases);
    }

    // --- 9. Eligibility Check ---

    function isEligible(address _arbitratorWallet) public view returns (bool) {
        bytes32 idHash = arbitratorToIdentity[_arbitratorWallet];
        Arbitrator memory arb = arbitrators[idHash];

        return (
            arb.wallet == _arbitratorWallet &&
            arb.active &&
            !arb.suspended &&
            arb.stake >= MINIMUM_STAKE &&
            arb.activeCases < MAX_ACTIVE_CASES &&
            identityRegister.isVerified(_arbitratorWallet)
        );
    }

    // --- 10. Weighted Random Case Assignment ---

    /// @notice Assigns a case to an arbitrator via weighted random selection.
    /// @dev Every eligible arbitrator gets a ticket count of BASE_WEIGHT + min(reputation,
    ///      MAX_REPUTATION_WEIGHT) + sqrt(stake / 1e6) * STAKE_WEIGHT_FACTOR, then one ticket
    ///      is drawn out of the pooled total. BASE_WEIGHT is sized to dominate the total for a
    ///      typical arbitrator, so reputation/stake shift the odds without deciding them.
    /// @param _caseId Opaque id from the calling dispute module. Used only as an entropy salt
    ///      and event topic — this contract does not validate the case itself.
    /// @return selected The arbitrator wallet chosen for this case.
    function assignRandomCase(uint256 _caseId) external onlyCourt returns (address selected) {
        (address[] memory pool, uint256[] memory weights, uint256 totalWeight, uint256 count) = _buildEligiblePool();
        if (count == 0) revert NotEnoughEligibleArbitrators();

        uint256 rand = _pseudoRandom(_caseId) % totalWeight;
        uint256 cumulative;
        for (uint256 i = 0; i < count; i++) {
            cumulative += weights[i];
            if (rand < cumulative) {
                selected = pool[i];
                break;
            }
        }

        // Defensive re-check: cheap, and guards against any future refactor that inserts an
        // external call between pool-build and this state write.
        if (!isEligible(selected)) revert Unauthorized();

        bytes32 idHash = arbitratorToIdentity[selected];
        Arbitrator storage arb = arbitrators[idHash];
        arb.activeCases += 1;

        emit CaseAssigned(idHash, selected, arb.activeCases);
        emit ArbitratorSelected(_caseId, selected, rand, totalWeight, count);
    }

    /// @notice Read-only view of the current eligible pool and each member's selection weight.
    /// @dev For UI "your odds" displays only. The actual draw only resolves inside
    ///      assignRandomCase() at execution time, so this can drift from block to block.
    function previewEligiblePool()
        external
        view
        returns (address[] memory pool, uint256[] memory weights, uint256 totalWeight)
    {
        (address[] memory p, uint256[] memory w, uint256 tw, uint256 count) = _buildEligiblePool();
        pool = new address[](count);
        weights = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            pool[i] = p[i];
            weights[i] = w[i];
        }
        totalWeight = tw;
    }

    // --- Internal Helpers ---

    function _removeArbitratorFromList(address _wallet, bytes32 _idHash) internal {
        uint256 index = arbitratorIndex[_wallet];
        uint256 lastIndex = arbitratorList.length - 1;

        if (index != lastIndex) {
            address lastArb = arbitratorList[lastIndex];
            arbitratorList[index] = lastArb;
            arbitratorIndex[lastArb] = index;
        }

        arbitratorList.pop();
        delete arbitratorIndex[_wallet];
        delete arbitratorToIdentity[_wallet];
        delete arbitrators[_idHash];
    }

    /// @dev Walks arbitratorList once and keeps only members that pass isEligible(), pairing
    ///      each with its selection weight. O(n) in the size of arbitratorList — fine at
    ///      hackathon/early-mainnet scale, but worth capping or moving off-chain if the
    ///      registry grows into the thousands.
    function _buildEligiblePool()
        internal
        view
        returns (address[] memory pool, uint256[] memory weights, uint256 totalWeight, uint256 count)
    {
        uint256 n = arbitratorList.length;
        pool = new address[](n);
        weights = new uint256[](n);

        for (uint256 i = 0; i < n; i++) {
            address wallet = arbitratorList[i];
            if (isEligible(wallet)) {
                bytes32 idHash = arbitratorToIdentity[wallet];
                uint256 w = _weightOf(arbitrators[idHash]);
                pool[count] = wallet;
                weights[count] = w;
                totalWeight += w;
                count++;
            }
        }
    }

    function _weightOf(Arbitrator storage arb) internal view returns (uint256) {
        uint256 repComponent = arb.reputation > MAX_REPUTATION_WEIGHT ? MAX_REPUTATION_WEIGHT : arb.reputation;
        uint256 stakeComponent = _sqrt(arb.stake / 1e6) * STAKE_WEIGHT_FACTOR;
        return BASE_WEIGHT + repComponent + stakeComponent;
    }

    /// @dev Integer square root, Babylonian method — same approach as Uniswap V2's Math library.
    ///      Used to dampen stake's influence so large stakers get better odds, not guaranteed wins.
    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    /// @dev Pseudo-randomness only. block.prevrandao / blockhash can be biased within a narrow
    ///      margin by the block proposer that last chooses whether to reveal a block — acceptable
    ///      for hackathon/testnet stakes, not for securing large real value.
    ///      TODO: swap for Chainlink VRF (or equivalent verifiable RNG) before mainnet.
    function _pseudoRandom(uint256 _salt) internal returns (uint256) {
        selectionNonce++;
        return uint256(
            keccak256(
                abi.encodePacked(
                    block.prevrandao,
                    block.timestamp,
                    blockhash(block.number - 1),
                    _salt,
                    selectionNonce
                )
            )
        );
    }

}
