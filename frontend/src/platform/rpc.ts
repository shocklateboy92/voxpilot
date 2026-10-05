import { VoxPilotRpc } from "@plugin/rpc";
import { client } from "./connection";

export const rpc = client.rpc(VoxPilotRpc);
