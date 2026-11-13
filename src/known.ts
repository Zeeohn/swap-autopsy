// Addresses and ABIs for 0x Settler, taken from the 0x-settler README and source
// (github.com/0xProject/0x-settler: README, src/core/SettlerErrors.sol,
// src/interfaces/ISettlerTakerSubmitted.sol, src/allowanceholder/IAllowanceHolder.sol).
import { parseAbi } from 'viem';

// The same address on every chain that supports the Cancun hardfork (Ethereum, Base, Arbitrum, ...).
export const ALLOWANCE_HOLDER = '0x0000000000001ff3684f28c67538d4d072c22734';
export const PERMIT2 = '0x000000000022d473030f116ddee9f6b43ac78ba3';
// Deployer/registry. ownerOf(feature) returns the current Settler; prev(feature) the previous one.
export const ZERO_EX_DEPLOYER = '0x00000000000004533fe15556b1e086bb1a72ceae';
export const FEATURE_TAKER_SUBMITTED = 2n;
// 0x uses this placeholder for the chain's native asset (ETH on Ethereum).
export const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

export const allowanceHolderAbi = parseAbi([
  'function exec(address operator, address token, uint256 amount, address target, bytes data) payable returns (bytes)',
]);

export const settlerAbi = parseAbi([
  'struct AllowedSlippage { address recipient; address buyToken; uint256 minAmountOut; }',
  'function execute(AllowedSlippage slippage, bytes[] actions, bytes32 zidAndAffiliate) payable returns (bool)',
  'function executeWithPermit(AllowedSlippage slippage, bytes[] actions, bytes32 zidAndAffiliate, bytes permitData) payable returns (bool)',
]);

export const deployerAbi = parseAbi([
  'function ownerOf(uint256 featureId) view returns (address)',
  'function prev(uint128 featureId) view returns (address)',
]);

export const erc20Abi = parseAbi([
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

// Errors a failed swap can return. Error(string) and Panic(uint256) are decoded by viem itself.
export const errorAbi = parseAbi([
  // 0x Settler (src/core/SettlerErrors.sol)
  'error TooMuchSlippage(address token, uint256 expected, uint256 actual)',
  'error ExcessiveSellAmount(address sellToken, uint256 maxSellAmount, uint256 sellAmount)',
  'error SignatureExpired(uint256 deadline)',
  'error MsgValueMismatch(uint256 expected, uint256 actual)',
  'error Underpayment(uint256 msgValueMin, uint256 msgValueActual)',
  'error ActionInvalid(uint256 i, bytes4 action, bytes data)',
  'error ZeroSellAmount(address token)',
  'error ZeroBuyAmount(address buyToken)',
  'error ConfusedDeputy()',
  'error InvalidTarget()',
  'error InvalidSender()',
  'error ForwarderNotAllowed()',
  'error InvalidSignature()',
  'error PermitExpired()',
  'error PermitFailed()',
  'error CounterfeitSettler(address)',
  // Permit2
  'error AllowanceExpired(uint256 deadline)',
  'error InsufficientAllowance(uint256 amount)',
  'error InvalidNonce()',
  'error InvalidContractSignature()',
  'error InvalidSigner()',
  // OpenZeppelin v5 ERC20
  'error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)',
  'error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)',
  // Seen bubbling up from liquidity sources in failed 0x swaps (names from 4byte.directory)
  'error QuoteExpired()',
  'error OrderExpired()',
  'error ReturnAmountIsNotEnough(uint256 result, uint256 minReturn)',
]);

// What each error usually means for the person who sent the swap, and what to try next.
export const hints: Record<string, string> = {
  TooMuchSlippage: 'The price moved between the quote and the block. The swap would have delivered less than the minimum, so Settler reverted it. Fix: fetch a fresh quote, or allow more slippage.',
  ExcessiveSellAmount: 'A pool asked for more of the sell token than the quote allowed. Fix: fetch a fresh quote.',
  SignatureExpired: 'The signed permit passed its deadline before the transaction landed. Fix: sign again and submit sooner.',
  MsgValueMismatch: 'The ETH sent with the transaction does not match the quote. Fix: send exactly the value from the quote.',
  Underpayment: 'The ETH sent with the transaction is below the minimum. Fix: send the value from the quote.',
  ActionInvalid: 'Settler did not recognize one of the encoded actions. This points to a bad or stale calldata build.',
  InvalidSignature: 'The permit signature does not match. Fix: sign the exact permit from the quote.',
  PermitExpired: 'The permit expired before the transaction landed.',
  AllowanceExpired: 'The Permit2 allowance expired. Fix: approve again.',
  InsufficientAllowance: 'The Permit2 allowance is too small for this trade. Fix: approve a larger amount.',
  InvalidNonce: 'The Permit2 nonce was already used. Usually a resubmitted or duplicate swap.',
  InvalidContractSignature: 'The sender is a smart-contract wallet, and its ERC-1271 check rejected the Permit2 signature. Fix: sign with the wallet that owns the tokens, or use the AllowanceHolder flow.',
  InvalidSigner: 'The Permit2 signature was signed by a different address than the token owner.',
  ERC20InsufficientBalance: 'The sender did not hold enough of the sell token when the swap ran.',
  ERC20InsufficientAllowance: 'The sender had not approved enough of the sell token for the spender.',
  QuoteExpired: 'A market maker\'s RFQ quote expired before the transaction landed. Fix: fetch a fresh quote and submit sooner.',
  OrderExpired: 'A signed order inside the route expired before the transaction landed. Fix: fetch a fresh quote.',
  ReturnAmountIsNotEnough: 'A liquidity source inside the route returned less than its own minimum. The price moved. Fix: fetch a fresh quote.',
  CounterfeitSettler: 'The target is not a genuine 0x Settler.',
};

// Names of contracts seen at the origin of failed 0x swaps (verified source on eth.blockscout.com, 13 Nov 2026).
export const labels: Record<string, string> = {
  '0xaddc26a3854feabfd20d6bf658254088d83a425a': 'MainnetSettler',
  '0x111111125421ca6dc452d289314280a0f8842a65': '1inch AggregationRouterV6',
  '0xbbbbbbb520d69a9775e85b458c58c648259fad5f': 'BebopSettlement',
  '0xc0ed888afe87ed1acf01d9f19bb850159e3ce434': 'DynamicSwapFeeHook (Uniswap v4 hook)',
};
