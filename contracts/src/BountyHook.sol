// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Minimal} from "./interfaces/IERC20Minimal.sol";

/// @notice Locally testable hook core for The Bounty Hook.
/// @dev The pool manager calls reportSwap from a Uniswap v4 afterSwap adapter in production.
contract BountyHook {
    enum SwapSide {
        Buy,
        Sell
    }

    struct BountyWindow {
        bytes32 poolId;
        address bountyToken;
        address quoteToken;
        uint64 startBlock;
        uint64 endBlock;
        uint256 totalBounty;
        uint256 totalQualifyingBuy;
        bool finalized;
    }

    uint16 public constant MAX_BOUNTY_BPS = 1_000;
    uint16 public immutable bountyBps;
    uint64 public immutable bountyWindowBlocks;
    uint256 public immutable minDumpAmount;
    address public owner;
    address public poolManager;

    mapping(bytes32 poolId => bytes32 windowId) public activeWindowByPool;
    mapping(bytes32 windowId => BountyWindow window) public windows;
    mapping(bytes32 windowId => mapping(address buyer => uint256 amount)) public buyerQualifyingBuys;
    mapping(bytes32 windowId => mapping(address buyer => uint256 amount)) public buyerClaimedRewards;
    mapping(bytes32 windowId => address[] buyers) private buyersByWindow;
    mapping(bytes32 windowId => mapping(address buyer => bool seen)) private buyerSeen;

    bool private locked;

    event PoolManagerUpdated(address indexed oldPoolManager, address indexed newPoolManager);
    event BountyOpened(
        bytes32 indexed windowId,
        bytes32 indexed poolId,
        address indexed bountyToken,
        address quoteToken,
        uint64 startBlock,
        uint64 endBlock,
        uint256 bountyAmount
    );
    event BountyFunded(
        bytes32 indexed windowId,
        address indexed seller,
        uint256 bountyAmount,
        uint256 sellAmount
    );
    event BountyBuyRecorded(bytes32 indexed windowId, address indexed buyer, uint256 buyAmount);
    event BountyWindowClosed(bytes32 indexed windowId, uint256 totalBounty, uint256 totalQualifyingBuy);
    event BountyClaimed(bytes32 indexed windowId, address indexed buyer, uint256 rewardAmount);

    error NotOwner();
    error NotPoolManager();
    error ReentrantCall();
    error InvalidConfig();
    error InvalidAddress();
    error WindowStillActive();
    error WindowMissing();
    error NothingToClaim();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyPoolManager() {
        if (msg.sender != poolManager) revert NotPoolManager();
        _;
    }

    modifier nonReentrant() {
        if (locked) revert ReentrantCall();
        locked = true;
        _;
        locked = false;
    }

    constructor(address initialPoolManager, uint16 initialBountyBps, uint64 windowBlocks, uint256 dumpThreshold) {
        if (initialPoolManager == address(0) || windowBlocks == 0 || initialBountyBps == 0) {
            revert InvalidConfig();
        }
        if (initialBountyBps > MAX_BOUNTY_BPS) revert InvalidConfig();

        owner = msg.sender;
        poolManager = initialPoolManager;
        bountyBps = initialBountyBps;
        bountyWindowBlocks = windowBlocks;
        minDumpAmount = dumpThreshold;
    }

    function setPoolManager(address newPoolManager) external onlyOwner {
        if (newPoolManager == address(0)) revert InvalidAddress();
        emit PoolManagerUpdated(poolManager, newPoolManager);
        poolManager = newPoolManager;
    }

    function reportSwap(
        bytes32 poolId,
        address trader,
        address bountyToken,
        address quoteToken,
        SwapSide side,
        uint256 amountIn
    ) external onlyPoolManager nonReentrant returns (bytes32 windowId) {
        if (trader == address(0) || bountyToken == address(0) || quoteToken == address(0)) {
            revert InvalidAddress();
        }

        if (side == SwapSide.Sell) {
            return _handleSell(poolId, trader, bountyToken, quoteToken, amountIn);
        }

        return _handleBuy(poolId, trader, amountIn);
    }

    function claim(bytes32 windowId) external nonReentrant returns (uint256 reward) {
        BountyWindow storage window = windows[windowId];
        if (window.startBlock == 0) revert WindowMissing();
        if (block.number <= window.endBlock) revert WindowStillActive();

        reward = claimable(windowId, msg.sender);
        if (reward == 0) revert NothingToClaim();

        buyerClaimedRewards[windowId][msg.sender] += reward;
        if (!IERC20Minimal(window.bountyToken).transfer(msg.sender, reward)) revert TransferFailed();

        emit BountyClaimed(windowId, msg.sender, reward);
    }

    function closeWindow(bytes32 windowId) external {
        BountyWindow storage window = windows[windowId];
        if (window.startBlock == 0) revert WindowMissing();
        if (block.number <= window.endBlock) revert WindowStillActive();
        if (!window.finalized) {
            window.finalized = true;
            if (activeWindowByPool[window.poolId] == windowId) {
                delete activeWindowByPool[window.poolId];
            }
            emit BountyWindowClosed(windowId, window.totalBounty, window.totalQualifyingBuy);
        }
    }

    function claimable(bytes32 windowId, address buyer) public view returns (uint256) {
        BountyWindow storage window = windows[windowId];
        if (window.totalQualifyingBuy == 0) return 0;

        uint256 gross = (window.totalBounty * buyerQualifyingBuys[windowId][buyer]) / window.totalQualifyingBuy;
        uint256 claimed = buyerClaimedRewards[windowId][buyer];
        return gross > claimed ? gross - claimed : 0;
    }

    function getWindow(bytes32 windowId) external view returns (BountyWindow memory) {
        return windows[windowId];
    }

    function buyers(bytes32 windowId) external view returns (address[] memory) {
        return buyersByWindow[windowId];
    }

    function _handleSell(
        bytes32 poolId,
        address seller,
        address bountyToken,
        address quoteToken,
        uint256 sellAmount
    ) private returns (bytes32 windowId) {
        if (sellAmount < minDumpAmount) return bytes32(0);

        uint256 bountyAmount = (sellAmount * bountyBps) / 10_000;
        if (bountyAmount == 0) return bytes32(0);
        if (!IERC20Minimal(bountyToken).transferFrom(seller, address(this), bountyAmount)) {
            revert TransferFailed();
        }

        windowId = activeWindowByPool[poolId];
        BountyWindow storage window = windows[windowId];

        if (window.startBlock == 0 || block.number > window.endBlock || window.finalized) {
            windowId = keccak256(abi.encode(poolId, block.number, seller, bountyAmount));
            activeWindowByPool[poolId] = windowId;
            window = windows[windowId];
            window.poolId = poolId;
            window.bountyToken = bountyToken;
            window.quoteToken = quoteToken;
            window.startBlock = uint64(block.number);
            window.endBlock = uint64(block.number) + bountyWindowBlocks;

            emit BountyOpened(
                windowId,
                poolId,
                bountyToken,
                quoteToken,
                window.startBlock,
                window.endBlock,
                bountyAmount
            );
        }

        window.totalBounty += bountyAmount;
        emit BountyFunded(windowId, seller, bountyAmount, sellAmount);
    }

    function _handleBuy(bytes32 poolId, address buyer, uint256 buyAmount) private returns (bytes32 windowId) {
        windowId = activeWindowByPool[poolId];
        BountyWindow storage window = windows[windowId];

        if (window.startBlock == 0 || window.finalized || block.number > window.endBlock || buyAmount == 0) {
            return bytes32(0);
        }

        if (!buyerSeen[windowId][buyer]) {
            buyerSeen[windowId][buyer] = true;
            buyersByWindow[windowId].push(buyer);
        }

        buyerQualifyingBuys[windowId][buyer] += buyAmount;
        window.totalQualifyingBuy += buyAmount;

        emit BountyBuyRecorded(windowId, buyer, buyAmount);
    }
}
