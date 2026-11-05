import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { pickMessages, wantsHuman } from "../src/bot";
import { MESSAGES } from "../src/business";
import { parseWhatsAppPayload } from "../src/channels/whatsapp";
import { safeEqual, verifyHmacSha256 } from "../src/crypto";

const payload = (messages: unknown[], phoneNumberId = "111") =>
  JSON.stringify({
    entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, messages } }] }],
  });

describe("signature check", () => {
  const body = '{"hello":"مرحبا"}';
  const valid = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;

  it("accepts a correct signature", async () => {
    expect(await verifyHmacSha256("secret", body, valid)).toBe(true);
  });

  it.each([
    ["wrong secret", "other", body, valid],
    ["changed body", "secret", `${body} `, valid],
    ["missing header", "secret", body, null],
    ["no prefix", "secret", body, valid.replace("sha256=", "")],
    ["not hex", "secret", body, "sha256=zz"],
    ["empty secret", "", body, valid],
  ])("rejects %s", async (_name, secret, signedBody, header) => {
    expect(await verifyHmacSha256(secret, signedBody, header)).toBe(false);
  });
});

describe("safeEqual", () => {
  it("compares strings", async () => {
    expect(await safeEqual("abc", "abc")).toBe(true);
    expect(await safeEqual("abc", "abd")).toBe(false);
    expect(await safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("parseWhatsAppPayload", () => {
  const base = { id: "m1", from: "393331112222", timestamp: "1000" };

  it("reads a text message", () => {
    const [message] = parseWhatsAppPayload(
      payload([{ ...base, type: "text", text: { body: " أهلا " } }]),
      "111",
    );
    expect(message).toMatchObject({ id: "m1", userId: "393331112222", text: "أهلا", timestamp: 1000 });
  });

  it("reads button replies", () => {
    const [message] = parseWhatsAppPayload(
      payload([{ ...base, type: "interactive", interactive: { button_reply: { title: "Yes" } } }]),
      "111",
    );
    expect(message?.text).toBe("Yes");
  });

  it("marks photos as unreadable and keeps a label", () => {
    const [message] = parseWhatsAppPayload(payload([{ ...base, type: "image" }]), "111");
    expect(message).toMatchObject({ text: null, label: "[image]" });
  });

  it("ignores reactions", () => {
    expect(parseWhatsAppPayload(payload([{ ...base, type: "reaction" }]), "111")).toEqual([]);
  });

  it("ignores delivery status events", () => {
    const body = JSON.stringify({
      entry: [
        {
          changes: [
            { value: { metadata: { phone_number_id: "111" }, statuses: [{ status: "delivered" }] } },
          ],
        },
      ],
    });
    expect(parseWhatsAppPayload(body, "111")).toEqual([]);
  });

  it("ignores messages for another number", () => {
    const body = payload([{ ...base, type: "text", text: { body: "hi" } }], "999");
    expect(parseWhatsAppPayload(body, "111")).toEqual([]);
  });

  it("survives malformed JSON", () => {
    expect(parseWhatsAppPayload("{oops", "111")).toEqual([]);
  });
});

describe("wantsHuman", () => {
  it.each(["موظف", "عايز اكلم موظف لو سمحت", "I want a HUMAN", "operatore per favore"])(
    "detects %s",
    (text) => expect(wantsHuman(text)).toBe(true),
  );

  it.each(["موظفين الشركة", "humanity", "reagent", "كام السعر؟"])("does not trigger on %s", (text) =>
    expect(wantsHuman(text)).toBe(false),
  );
});

describe("pickMessages", () => {
  it("uses Arabic for Arabic text and the international set otherwise", () => {
    expect(pickMessages("مرحبا")).toBe(MESSAGES.ar);
    expect(pickMessages("ciao")).toBe(MESSAGES.intl);
    expect(pickMessages(null)).toBe(MESSAGES.intl);
  });
});
