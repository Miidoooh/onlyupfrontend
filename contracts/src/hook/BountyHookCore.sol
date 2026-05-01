// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IBountyPressurePolicy} from "../interfaces/IBountyPressurePolicy.sol";
import {IERC20Minimal} from "../interfaces/IERC20Minimal.sol";
import {LaunchConfig} from "../launch/LaunchConfig.sol";

contract BountyHookCore {
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

    struct PoolConfig {
        address bountyToken;
        address quoteToken;
        bool enabled;
    }

    uint64 public immutable bountyWindowBlocks;
    uint256 public immutable minDumpAmount;
    address public owner;
    address public reporter;
    IBountyPressurePolicy public pressurePolicy;

    mapping(bytes32 poolId => PoolConfig config) public poolConfigs;
    mapping(bytes32 poolId => bytes32 windowId) public activeWindowByPool;
    mapping(bytes32 windowId => BountyWindow window) public windows;
    mapping(bytes32 windowId => mapping(address buyer => uint256 amount)) public buyerQualifyingBuys;
    mapping(bytes32 windowId => mapping(address buyer => uint256 amount)) public buyerClaimedRewards;
    mapping(bytes32 windowId => address[] buyers) private buyersByWindow;
    mapping(bytes32 windowId => mapping(address buyer => bool seen)) private buyerSeen;

    bool private locked;

    event ReporterUpdated(address indexed oldReporter, address indexed newReporter);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PoolConfigured(bytes32 indexed poolId, address indexed bountyToken, address indexed quoteToken, bool enabled);
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
        uint256 sellAmount,
        uint16 bountyBps
    );
    event BountyBuyRecorded(bytes32 indexed windowId, address indexed buyer, uint256 buyAmount);
    event BountyPressureUpdated(bytes32 indexed poolId, uint256 sellVolume, uint256 buyVolume, uint16 bountyBps);
    event BountyWindowClosed(bytes32 indexed windowId, uint256 totalBounty, uint256 totalQualifyingBuy);
    event BountyClaimed(bytes32 indexed windowId, address indexed buyer, uint256 rewardAmount);

    error NotOwner();
    error NotReporter();
    error ReentrantCall();
    error InvalidConfig();
    error InvalidAddress();
    error PoolNotEnabled();
    error PoolTokenMismatch();
    error WindowStillActive();
    error WindowMissing();
    error NothingToClaim();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyReporter() {
        if (msg.sender != reporter) revert NotReporter();
        _;
    }

    modifier nonReentrant() {
        if (locked) revert ReentrantCall();
        locked = true;
        _;
        locked = false;
    }

    constructor(address initialOwner, address initialReporter, address initialPolicy, uint64 windowBlocks, uint256 dumpThreshold) {
        if (initialOwner == address(0) || initialReporter == address(0) || initialPolicy == address(0)) {
            revert InvalidAddress();
        }
        if (windowBlocks == 0) revert InvalidConfig();

        owner = initialOwner;
        reporter = initialReporter;
        pressurePolicy = IBountyPressurePolicy(initialPolicy);
        bountyWindowBlocks = windowBlocks;
        minDumpAmount = dumpThreshold;
    }

    function setReporter(address newReporter) external onlyOwner {
        if (newReporter == address(0)) revert InvalidAddress();
        emit ReporterUpdated(reporter, newReporter);
        reporter = newReporter;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function configurePool(bytes32 poolId, address bountyToken, address quoteToken, bool enabled) external onlyOwner {
        if (poolId == bytes32(0) || bountyToken == address(0)) revert InvalidAddress();
        poolConfigs[poolId] = PoolConfig({bountyToken: bountyToken, quoteToken: quoteToken, enabled: enabled});
        emit PoolConfigured(poolId, bountyToken, quoteToken, enabled);
    }

    /// @notice Legacy single-entry reporter API. Pulls bounty via `transferFrom(seller)`
    ///         and only works when the seller has approved this contract — i.e.
    ///         direct EOA reporting and unit tests. Production swaps go through
    ///         {recordSell}/{recordBuy} which assume the v4 hook has already
    ///         skimmed and forwarded the bounty natively (no allowance needed).
    function reportSwap(
        bytes32 poolId,
        address trader,
        address bountyToken,
        address quoteToken,
        SwapSide side,
        uint256 amountIn
    ) external onlyReporter nonReentrant returns (bytes32 windowId) {
        _validatePool(poolId, bountyToken, quoteToken);
        if (trader == address(0)) revert InvalidAddress();

        pressurePolicy.recordFlow(poolId, side == SwapSide.Sell, amountIn);
        (uint256 sells, uint256 buys, uint16 bountyBps) = pressurePolicy.pressure(poolId);
        emit BountyPressureUpdated(poolId, sells, buys, bountyBps);

        if (side == SwapSide.Sell) {
            return _handleSellLegacy(poolId, trader, bountyToken, quoteToken, amountIn, bountyBps);
        }

        return _handleBuy(poolId, trader, amountIn);
    }

    /// @notice v4-native sell entry. The v4 hook skims `bountyAmount` of
    ///         `bountyToken` from the swap input via `BeforeSwapDelta` +
    ///         `poolManager.take`, transfers it to this contract, then calls
    ///         this method. No allowance from the seller is required.
    /// @dev Caller MUST be the configured reporter (the v4 hook) AND have
    ///      already transferred `bountyAmount` bountyToken to this contract.
    function recordSell(
        bytes32 poolId,
        address seller,
        address bountyToken,
        address quoteToken,
        uint256 sellAmount,
        uint256 bountyAmount
    ) external onlyReporter nonReentrant returns (bytes32 windowId) {
        _validatePool(poolId, bountyToken, quoteToken);
        if (seller == address(0)) revert InvalidAddress();

        pressurePolicy.recordFlow(poolId, true, sellAmount);
        (uint256 sells, uint256 buys, uint16 bountyBps) = pressurePolicy.pressure(poolId);
        emit BountyPressureUpdated(poolId, sells, buys, bountyBps);

        if (sellAmount < minDumpAmount || bountyAmount == 0) return bytes32(0);

        windowId = activeWindowByPool[poolId];
        BountyWindow storage window = windows[windowId];

        if (window.startBlock == 0 || block.number > window.endBlock || window.finalized) {
            windowId = keccak256(abi.encode(poolId, block.number, seller, bountyAmount, bountyBps));
            activeWindowByPool[poolId] = windowId;
            window = windows[windowId];
            window.poolId = poolId;
            window.bountyToken = bountyToken;
            window.quoteToken = quoteToken;
            window.startBlock = uint64(block.number);
            window.endBlock = uint64(block.number) + bountyWindowBlocks;
            emit BountyOpened(windowId, poolId, bountyToken, quoteToken, window.startBlock, window.endBlock, bountyAmount);
        }

        window.totalBounty += bountyAmount;
        emit BountyFunded(windowId, seller, bountyAmount, sellAmount, bountyBps);
    }

    /// @notice v4-native buy entry. No funds movement; just records the buy
    ///         against the active window (if any) so the buyer's qualifying
    ///         volume grows.
    function recordBuy(
        bytes32 poolId,
        address buyer,
        address bountyToken,
        address quoteToken,
        uint256 buyAmount
    ) external onlyReporter nonReentrant returns (bytes32 windowId) {
        _validatePool(poolId, bountyToken, quoteToken);
        if (buyer == address(0)) revert InvalidAddress();

        pressurePolicy.recordFlow(poolId, false, buyAmount);
        (uint256 sells, uint256 buys, uint16 bountyBps) = pressurePolicy.pressure(poolId);
        emit BountyPressureUpdated(poolId, sells, buys, bountyBps);

        return _handleBuy(poolId, buyer, buyAmount);
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

    /// @dev Legacy path: pulls bounty via `transferFrom(seller)`. Used by
    ///      `reportSwap`. Production v4 path uses {recordSell} which receives
    ///      pre-skimmed funds without needing an allowance.
    function _handleSellLegacy(
        bytes32 poolId,
        address seller,
        address bountyToken,
        address quoteToken,
        uint256 sellAmount,
        uint16 bountyBps
    ) private returns (bytes32 windowId) {
        if (sellAmount < minDumpAmount) return bytes32(0);

        uint256 bountyAmount = (sellAmount * bountyBps) / 10_000;
        if (bountyAmount == 0) return bytes32(0);
        if (!IERC20Minimal(bountyToken).transferFrom(seller, address(this), bountyAmount)) revert TransferFailed();

        windowId = activeWindowByPool[poolId];
        BountyWindow storage window = windows[windowId];

        if (window.startBlock == 0 || block.number > window.endBlock || window.finalized) {
            windowId = keccak256(abi.encode(poolId, block.number, seller, bountyAmount, bountyBps));
            activeWindowByPool[poolId] = windowId;
            window = windows[windowId];
            window.poolId = poolId;
            window.bountyToken = bountyToken;
            window.quoteToken = quoteToken;
            window.startBlock = uint64(block.number);
            window.endBlock = uint64(block.number) + bountyWindowBlocks;
            emit BountyOpened(windowId, poolId, bountyToken, quoteToken, window.startBlock, window.endBlock, bountyAmount);
        }

        window.totalBounty += bountyAmount;
        emit BountyFunded(windowId, seller, bountyAmount, sellAmount, bountyBps);
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

    function _validatePool(bytes32 poolId, address bountyToken, address quoteToken) private view {
        PoolConfig storage config = poolConfigs[poolId];
        if (!config.enabled) revert PoolNotEnabled();
        if (config.bountyToken != bountyToken || config.quoteToken != quoteToken) revert PoolTokenMismatch();
    }
}
