import type { Channel, Env } from "../types";
import { WhatsAppChannel } from "./whatsapp";

/** Register new platforms here. Each one gets its own /webhook/<name> address. */
export function getChannel(name: string, env: Env): Channel | null {
  switch (name) {
    case "whatsapp":
      return new WhatsAppChannel(env);
    default:
      return null;
  }
}
