import type { AppType } from "@backend/index";
import { hc } from "hono/client";

export const rpc = hc<AppType>(window.location.origin);
