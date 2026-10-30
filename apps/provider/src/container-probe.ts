import { assertContainerProfile } from "./container-profile.js";
const role = process.argv[2];
if (role !== "gateway" && role !== "worker")
    throw new Error("Specify sandbox role");
console.log(JSON.stringify(await assertContainerProfile(role)));
