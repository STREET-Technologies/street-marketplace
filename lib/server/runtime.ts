import "server-only";
import { createStreetApi } from "./street-api";

// Stateless adapter; cookies/tokens are supplied separately for every request.
export const streetApi = createStreetApi();
