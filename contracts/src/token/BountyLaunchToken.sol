// SPDX-License-Identifier: MIT


/* 
   OnlyUp is the only token where dumps dont hurt the chart, dumps print. 
   
   Whales sell, the v4 hook skims dynamically a 5.00% - 10.00% fee, 
   the next apes split that bag.

   With the help of V4 hooks the team has developed a new innovative tokenomics 
   where volume pays the buyers in a whole new way. Check the website for a more 
   detailed information...

   https://x.com/onlyupv4
   https://t.me/onlyupv4
   https://onlyupv4.xyz


*/
pragma solidity ^0.8.24;

import {LaunchConfig} from "../launch/LaunchConfig.sol";

contract BountyLaunchToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public immutable totalSupply;

    address public owner;
    address public pendingOwner;
    bool public tradingEnabled;
    bool public limitsEnabled = true;
    uint256 public maxTxAmount;
    uint256 public maxWalletAmount;

    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;
    mapping(address account => bool exempt) public isLimitExempt;
    mapping(address account => bool automatedMarketMaker) public automatedMarketMakerPairs;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event TradingEnabled(uint256 blockNumber);
    event LimitsUpdated(bool enabled, uint256 maxTxAmount, uint256 maxWalletAmount);
    event LimitExemptionUpdated(address indexed account, bool exempt);
    event AutomatedMarketMakerPairUpdated(address indexed pair, bool enabled);

    error NotOwner();
    error ZeroAddress();
    error TradingDisabled();
    error MaxTxExceeded();
    error MaxWalletExceeded();
    error InvalidLimit();
    error BalanceTooLow();
    error AllowanceTooLow();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(string memory tokenName, string memory tokenSymbol, address initialOwner, address initialSupplyReceiver) {
        if (initialOwner == address(0) || initialSupplyReceiver == address(0)) revert ZeroAddress();

        name = tokenName;
        symbol = tokenSymbol;
        owner = initialOwner;
        totalSupply = LaunchConfig.DEFAULT_SUPPLY;
        // bps math: 200 / 10_000 = 2 % of supply at launch.
        maxTxAmount = (totalSupply * LaunchConfig.MAX_LAUNCH_LIMIT_BPS) / 10_000;
        maxWalletAmount = maxTxAmount;

        isLimitExempt[initialOwner] = true;
        isLimitExempt[initialSupplyReceiver] = true;
        isLimitExempt[address(this)] = true;

        balanceOf[initialSupplyReceiver] = totalSupply;
        emit Transfer(address(0), initialSupplyReceiver, totalSupply);
        emit OwnershipTransferred(address(0), initialOwner);
        emit LimitExemptionUpdated(initialOwner, true);
        emit LimitExemptionUpdated(initialSupplyReceiver, true);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < amount) revert AllowanceTooLow();
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
            emit Approval(from, msg.sender, allowance[from][msg.sender]);
        }
        _transfer(from, to, amount);
        return true;
    }

    function enableTrading() external onlyOwner {
        tradingEnabled = true;
        emit TradingEnabled(block.number);
    }

    function setLimits(uint256 newMaxTxAmount, uint256 newMaxWalletAmount) external onlyOwner {
        uint256 minimumLimit = totalSupply / 1_000;
        if (newMaxTxAmount < minimumLimit || newMaxWalletAmount < minimumLimit) revert InvalidLimit();
        maxTxAmount = newMaxTxAmount;
        maxWalletAmount = newMaxWalletAmount;
        emit LimitsUpdated(limitsEnabled, newMaxTxAmount, newMaxWalletAmount);
    }

    function setLimitsEnabled(bool enabled) external onlyOwner {
        limitsEnabled = enabled;
        emit LimitsUpdated(enabled, maxTxAmount, maxWalletAmount);
    }

    function setLimitExempt(address account, bool exempt) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        isLimitExempt[account] = exempt;
        emit LimitExemptionUpdated(account, exempt);
    }

    function setAutomatedMarketMakerPair(address pair, bool enabled) external onlyOwner {
        if (pair == address(0)) revert ZeroAddress();
        automatedMarketMakerPairs[pair] = enabled;
        emit AutomatedMarketMakerPairUpdated(pair, enabled);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        address oldOwner = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        isLimitExempt[msg.sender] = true;
        emit OwnershipTransferred(oldOwner, msg.sender);
        emit LimitExemptionUpdated(msg.sender, true);
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (from == address(0) || to == address(0)) revert ZeroAddress();
        if (balanceOf[from] < amount) revert BalanceTooLow();

        bool exempt = isLimitExempt[from] || isLimitExempt[to];
        if (!tradingEnabled && !exempt) revert TradingDisabled();

        if (limitsEnabled && !exempt) {
            if (amount > maxTxAmount) revert MaxTxExceeded();
            if (!automatedMarketMakerPairs[to] && balanceOf[to] + amount > maxWalletAmount) {
                revert MaxWalletExceeded();
            }
        }

        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
