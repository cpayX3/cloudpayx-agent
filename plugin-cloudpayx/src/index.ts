import { Plugin } from "@elizaos/core";
import { repairTransactionAction } from "./actions/repair";

export const cloudpayxPlugin: Plugin = {
    name: "plugin-cloudpayx",
    description: "Autonomous machine-to-machine XRPL error mitigation and billing gateway integration.",
    actions: [repairTransactionAction],
    providers: [],
    evaluators: []
};
export default cloudpayxPlugin;