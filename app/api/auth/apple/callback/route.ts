import { json } from "../../../../../lib/server/web-api";
export const dynamic = "force-dynamic";
// Popup mode returns via Apple JS; unsolicited redirects never establish a session.
export function GET() {
  return json(
    { error: "Return to STREET and choose Continue with Apple." },
    400,
  );
}
export function POST() {
  return json({ error: "Use the Apple sign-in popup on STREET." }, 405);
}
