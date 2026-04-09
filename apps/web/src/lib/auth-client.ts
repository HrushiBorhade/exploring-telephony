import { createAuthClient } from "better-auth/react";
import { phoneNumberClient, adminClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080",
  plugins: [phoneNumberClient(), adminClient()],
});

export const { useSession, signOut } = authClient;
