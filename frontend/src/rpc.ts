import type { AppType } from "@backend/index";
import { hc } from "hono/client";
import { BACKEND_PREFIX } from "./backend-base";

export const rpc = hc<AppType>(`${window.location.origin}${BACKEND_PREFIX}`);
