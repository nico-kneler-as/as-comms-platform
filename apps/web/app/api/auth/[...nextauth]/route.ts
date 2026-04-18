import { handlers } from "../../../../src/server/auth";

// The Auth.js v5 callback endpoints must not be pre-rendered — they need to
// read cookies + set-cookie on every request.
export const dynamic = "force-dynamic";

export const { GET, POST } = handlers;
