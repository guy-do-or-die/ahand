// The public surface of @ahand/abi. Hand-written. The ABIs and the deployment records come from
// generated.ts, which @wagmi/cli writes from forge's build and contracts/deployments (wagmi.config.ts);
// the ABIs keep the names @wagmi/cli gives them, so a package of hooks generated from them later
// (@ahand/react) names them the same way.
export { aHandCoreAbi, mockUsdAbi, DEPLOYMENTS } from "./generated.js";
export type { Deployment, DeploymentToken, TokenKind, HexAddress, Hex32 } from "./deployment.js";
export { parseDeployment, DeploymentError } from "./deployment.js";
export type { Network, Usdc } from "./networks.js";
export { NETWORKS, coreOf, networkOf, usdcOf } from "./networks.js";
