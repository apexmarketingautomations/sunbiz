import { getChatGPTUser } from "../../chatgpt-auth";

export async function GET() {
  const user = await getChatGPTUser();
  return Response.json({ signedIn: Boolean(user), operator: true, accessMode: "self-use", user: user ? { displayName:user.displayName, email:user.email } : null }, { headers: { "cache-control":"no-store" } });
}
