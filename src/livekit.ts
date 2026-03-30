import {
  RoomServiceClient,
  SipClient,
  EgressClient,
} from "livekit-server-sdk";
import { env } from "./env";

const httpUrl = env.LIVEKIT_URL.replace("wss://", "https://");

export const roomService = new RoomServiceClient(httpUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
export const sipClient = new SipClient(httpUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
export const egressClient = new EgressClient(httpUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
