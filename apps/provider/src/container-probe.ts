import { claimProviderHost } from "./ownership.js";
import { gatewayOwnershipScope } from "./container-profile.js";
import { assertContainerProfile } from "./container-profile.js";
const role = process.argv[2];
if (role !== "gateway" && role !== "worker")
    throw new Error("Specify sandbox role");
console.log(JSON.stringify(await assertContainerProfile(role)));

if (role === "gateway" && process.argv[3] === "--claim-owner")
    console.log(
        JSON.stringify(
            await claimProviderHost("/state", await gatewayOwnershipScope()),
        ),
    );
