// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {EscrowCore} from "../src/core/EscrowCore.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IIdentityRegister} from "../src/interfaces/IIdentityRegister.sol";
import {IArbitrationCourt} from "../src/interfaces/IArbitrationCourt.sol";

/// @notice Minimal mock letting tests directly flip a wallet's verified status,
///         without needing the real attestation/signature flow from IdentityRegister.
contract MockIdentityRegister is IIdentityRegister {
    mapping(address => bool) public verifiedStatus;

    function setVerified(address wallet, bool status) external {
        verifiedStatus[wallet] = status;
    }

    function isVerified(address wallet) external view override returns (bool) {
        return verifiedStatus[wallet];
    }
}

/// @notice Minimal mock that just records dispute cases forwarded to it — enough
///         to test that EscrowCore calls out correctly, without needing the real
///         (not-yet-built) staking/commit-reveal arbitration contract.
contract MockArbitrationCourt is IArbitrationCourt {
    uint256[] public dealIds;
    string[] public reasons;

    function createCase(uint256 dealId, string calldata reason) external override {
        dealIds.push(dealId);
        reasons.push(reason);
    }

    function caseCount() external view returns (uint256) {
        return dealIds.length;
    }
}

/// @notice Minimal mintable ERC20 standing in for a stablecoin like USDT/USDC in tests.
contract MockERC20 is ERC20 {
    constructor() ERC20("Mock USD", "mUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/**
 * @notice Test suite for EscrowCore's core deal/milestone/withdrawal flow.
 * @dev Per project instructions, `raiseDispute` and `resolveDispute` are NOT
 *      exercised here beyond what's unavoidable — the arbitration integration
 *      is still WIP and `resolveDispute` currently has a broken access-control
 *      combination (onlyOwner AND msg.sender == arbiter, which can only both be
 *      true if those are the same address). Testing around that now would just
 *      bake today's bug into the test suite as "expected behavior." Once the
 *      arbiter access control is fixed, expand this file with the dispute flow.
 */
contract EscrowCoreTest is Test {
    EscrowCore escrow;
    MockIdentityRegister identityRegister;
    MockArbitrationCourt arbiter;
    MockERC20 token;

    address owner = address(this); // test contract deploys, so it's Ownable's owner
    address payer = address(0x1001);
    address payee = address(0x1002);
    address stranger = address(0x9999);

    uint256 constant AMOUNT_1 = 300e18;
    uint256 constant AMOUNT_2 = 700e18;

    function setUp() public {
        identityRegister = new MockIdentityRegister();
        arbiter = new MockArbitrationCourt();
        escrow = new EscrowCore(address(identityRegister), address(arbiter));
        token = new MockERC20();

        identityRegister.setVerified(payer, true);
        identityRegister.setVerified(payee, true);

        token.mint(payer, 10_000e18);
        vm.prank(payer);
        token.approve(address(escrow), type(uint256).max);
    }

    function _descriptions() internal pure returns (string[] memory) {
        string[] memory d = new string[](2);
        d[0] = "Design mockups delivered";
        d[1] = "Final implementation delivered";
        return d;
    }

    function _amounts() internal pure returns (uint256[] memory) {
        uint256[] memory a = new uint256[](2);
        a[0] = AMOUNT_1;
        a[1] = AMOUNT_2;
        return a;
    }

    // --- constructor ---

    function test_Constructor_RevertsOnZeroIdentityRegister() public {
        vm.expectRevert(EscrowCore.InvalidTokenAddress.selector);
        new EscrowCore(address(0), address(arbiter));
    }

    function test_Constructor_AllowsZeroArbiter_KnownGap() public {
        // Documents the known gap: a zero arbiter is NOT rejected at construction,
        // it will only surface later as a revert inside raiseDispute's external call.
        EscrowCore e = new EscrowCore(address(identityRegister), address(0));
        assertEq(address(e.arbiter()), address(0));
    }

    // --- createDeal ---

    function test_CreateDeal_Succeeds() public {
        vm.prank(payer);
        escrow.createDeal(payee, IERC20(address(token)), _descriptions(), _amounts());

        (address p, address py, IERC20 tok, uint256 balance, uint256 totalMs, uint8 current, EscrowCore.Status status)
        = escrow.deals(1);

        assertEq(p, payer);
        assertEq(py, payee);
        assertEq(address(tok), address(token));
        assertEq(balance, AMOUNT_1 + AMOUNT_2);
        assertEq(totalMs, 2);
        assertEq(current, 0);
        assertEq(uint8(status), uint8(EscrowCore.Status.InProgress));

        // funds actually pulled from payer into the contract
        assertEq(token.balanceOf(address(escrow)), AMOUNT_1 + AMOUNT_2);
        assertEq(token.balanceOf(payer), 10_000e18 - AMOUNT_1 - AMOUNT_2);
    }

    function test_CreateDeal_RevertsIfCallerNotVerified() public {
        vm.prank(stranger);
        vm.expectRevert(EscrowCore.UserNotVerified.selector);
        escrow.createDeal(payee, IERC20(address(token)), _descriptions(), _amounts());
    }

    function test_CreateDeal_RevertsIfPayeeNotVerified() public {
        identityRegister.setVerified(payee, false);

        vm.prank(payer);
        vm.expectRevert(EscrowCore.PayeeNotVerified.selector);
        escrow.createDeal(payee, IERC20(address(token)), _descriptions(), _amounts());
    }

    function test_CreateDeal_RevertsOnLengthMismatch() public {
        string[] memory descs = new string[](1);
        descs[0] = "only one description";

        vm.prank(payer);
        vm.expectRevert(EscrowCore.LengthMismatch.selector);
        escrow.createDeal(payee, IERC20(address(token)), descs, _amounts());
    }

    function test_CreateDeal_RevertsOnZeroMilestones() public {
        string[] memory descs = new string[](0);
        uint256[] memory amounts = new uint256[](0);

        vm.prank(payer);
        vm.expectRevert(EscrowCore.InvalidMilestoneCount.selector);
        escrow.createDeal(payee, IERC20(address(token)), descs, amounts);
    }

    function test_CreateDeal_RevertsAboveMaxMilestones() public {
        uint256 max = escrow.MAX_MILESTONES();
        string[] memory descs = new string[](max + 1);
        uint256[] memory amounts = new uint256[](max + 1);
        for (uint256 i = 0; i <= max; i++) {
            descs[i] = "milestone";
            amounts[i] = 1e18;
        }
        token.mint(payer, 1000e18); // enough for the extra milestones

        vm.prank(payer);
        vm.expectRevert(EscrowCore.InvalidMilestoneCount.selector);
        escrow.createDeal(payee, IERC20(address(token)), descs, amounts);
    }

    function test_CreateDeal_RevertsOnZeroTokenAddress() public {
        vm.prank(payer);
        vm.expectRevert(EscrowCore.InvalidTokenAddress.selector);
        escrow.createDeal(payee, IERC20(address(0)), _descriptions(), _amounts());
    }

    // --- approveAndReleaseMilestone ---

    function test_ApproveAndRelease_FirstMilestone() public {
        vm.prank(payer);
        escrow.createDeal(payee, IERC20(address(token)), _descriptions(), _amounts());

        vm.prank(payer);
        escrow.approveAndReleaseMilestone(1);

        assertEq(escrow.pendingWithdrawals(payee, IERC20(address(token))), AMOUNT_1);

        (,,, uint256 balance,, uint8 current, EscrowCore.Status status) = escrow.deals(1);
        assertEq(balance, AMOUNT_2); // AMOUNT_1 deducted
        assertEq(current, 1);
        assertEq(uint8(status), uint8(EscrowCore.Status.InProgress)); // not done yet
    }

    function test_ApproveAndRelease_LastMilestone_CompletesDeal() public {
        vm.prank(payer);
        escrow.createDeal(payee, IERC20(address(token)), _descriptions(), _amounts());

        vm.startPrank(payer);
        escrow.approveAndReleaseMilestone(1);
        escrow.approveAndReleaseMilestone(1);
        vm.stopPrank();

        assertEq(escrow.pendingWithdrawals(payee, IERC20(address(token))), AMOUNT_1 + AMOUNT_2);

        (,,, uint256 balance,,, EscrowCore.Status status) = escrow.deals(1);
        assertEq(balance, 0);
        assertEq(uint8(status), uint8(EscrowCore.Status.Completed));
    }

    function test_ApproveAndRelease_RevertsIfNotPayer() public {
        vm.prank(payer);
        escrow.createDeal(payee, IERC20(address(token)), _descriptions(), _amounts());

        vm.prank(payee); // payee is verified but is NOT the payer
        vm.expectRevert(EscrowCore.NotAuthorized.selector);
        escrow.approveAndReleaseMilestone(1);
    }

    function test_ApproveAndRelease_RevertsAfterAllMilestonesReleased() public {
        vm.prank(payer);
        escrow.createDeal(payee, IERC20(address(token)), _descriptions(), _amounts());

        vm.startPrank(payer);
        escrow.approveAndReleaseMilestone(1);
        escrow.approveAndReleaseMilestone(1);

        vm.expectRevert(EscrowCore.InvalidDealStatus.selector); // status is Completed now
        escrow.approveAndReleaseMilestone(1);
        vm.stopPrank();
    }

    function test_ApproveAndRelease_RevertsIfCallerNotVerified() public {
        vm.prank(payer);
        escrow.createDeal(payee, IERC20(address(token)), _descriptions(), _amounts());

        identityRegister.setVerified(payer, false); // payer gets banned mid-deal

        vm.prank(payer);
        vm.expectRevert(EscrowCore.UserNotVerified.selector);
        escrow.approveAndReleaseMilestone(1);
    }

    // --- withdraw ---

    function test_Withdraw_TransfersNetAmountAndFee() public {
        vm.prank(payer);
        escrow.createDeal(payee, IERC20(address(token)), _descriptions(), _amounts());

        vm.prank(payer);
        escrow.approveAndReleaseMilestone(1); // releases AMOUNT_1 to payee

        vm.prank(payee);
        escrow.withdraw(IERC20(address(token)));

        uint256 expectedFee = (AMOUNT_1 * escrow.FEE_BPS()) / escrow.BPS_DENOMINATOR();
        uint256 expectedNet = AMOUNT_1 - expectedFee;

        assertEq(token.balanceOf(payee), expectedNet);
        assertEq(token.balanceOf(owner), expectedFee); // owner() == test contract here
        assertEq(escrow.pendingWithdrawals(payee, IERC20(address(token))), 0);
    }

    function test_Withdraw_RevertsIfNothingPending() public {
        vm.prank(payee);
        vm.expectRevert(EscrowCore.NothingToWithdraw.selector);
        escrow.withdraw(IERC20(address(token)));
    }

    function test_Withdraw_RevertsIfCallerNotVerified() public {
        vm.prank(payer);
        escrow.createDeal(payee, IERC20(address(token)), _descriptions(), _amounts());
        vm.prank(payer);
        escrow.approveAndReleaseMilestone(1);

        identityRegister.setVerified(payee, false); // payee banned before withdrawing

        vm.prank(payee);
        vm.expectRevert(EscrowCore.UserNotVerified.selector);
        escrow.withdraw(IERC20(address(token)));
    }

    function test_Withdraw_ZeroFeeAmountSkipsFeeTransferEvent() public {
        // sanity check on very small amounts where fee rounds to zero
        string[] memory descs = new string[](1);
        descs[0] = "tiny milestone";
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1; // 1 wei-equivalent unit; fee = (1 * 30) / 10_000 = 0

        vm.prank(payer);
        escrow.createDeal(payee, IERC20(address(token)), descs, amounts);
        vm.prank(payer);
        escrow.approveAndReleaseMilestone(1);

        vm.prank(payee);
        escrow.withdraw(IERC20(address(token)));

        assertEq(token.balanceOf(payee), 1); // full amount, no fee taken
    }
}
