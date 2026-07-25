import { describe, it, expect } from "vitest";
import { buildGiveMessage, parseGiveMessage, thankPathFor } from "./giveLink";

/** Serialize a thank payload the way useSolveFlow does (base64url of JSON). */
function encodeFragment(payload: unknown): string {
  return btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const validPayload = {
  give: {
    handId: "7",
    solver: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    solutionHash: "0x" + "ab".repeat(32),
    finalClaimBps: 10000,
  },
  giveSig: "0x" + "cd".repeat(65),
  shakes: [],
};

const fragment = encodeFragment(validPayload);
const solveUrl = `https://ahand.example/h/7/thank#${fragment}`;

describe("give message codec", () => {
  it("round-trips note + link", () => {
    const text = buildGiveMessage({ solveUrl, solutionText: "I can sublet you my flat in July." });
    const parsed = parseGiveMessage(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.handId).toBe("7");
    expect(parsed!.fragment).toBe(fragment);
    expect(parsed!.note).toBe("I can sublet you my flat in July.");
  });

  it("round-trips a bare link (empty note)", () => {
    const text = buildGiveMessage({ solveUrl, solutionText: "   " });
    expect(text).toBe(solveUrl);
    const parsed = parseGiveMessage(text);
    expect(parsed!.note).toBe("");
    expect(parsed!.handId).toBe("7");
  });

  it("tolerates surrounding chatter and emoji", () => {
    const parsed = parseGiveMessage(`hey! 🙌 here's my give:\n${solveUrl}\nsee you`);
    expect(parsed).not.toBeNull();
    expect(parsed!.handId).toBe("7");
    expect(parsed!.note).toContain("hey! 🙌");
    expect(parsed!.note).toContain("see you");
    expect(parsed!.note).not.toContain("/thank#");
  });

  it("parses links minted on any origin and rebuilds a local path", () => {
    const foreign = `https://abc123.ngrok-free.app/h/42/thank#${fragment}`;
    const parsed = parseGiveMessage(foreign);
    expect(parsed).not.toBeNull();
    expect(thankPathFor(parsed!)).toBe(`/h/42/thank#${fragment}`);
  });

  it("rejects plain chatter and foreign links", () => {
    expect(parseGiveMessage("gm, how's the hand going?")).toBeNull();
    expect(parseGiveMessage("https://example.com/some/other/link")).toBeNull();
    expect(parseGiveMessage(`https://ahand.example/h/7#${fragment}`)).toBeNull();
  });

  it("rejects a thank link whose fragment is not base64url JSON", () => {
    expect(parseGiveMessage("https://ahand.example/h/7/thank#notbase64!!!")).toBeNull();
    expect(parseGiveMessage("https://ahand.example/h/7/thank#YWJjZGVm")).toBeNull(); // "abcdef"
  });

  it("rejects payloads missing give, giveSig, or shakes", () => {
    const noSig = encodeFragment({ give: validPayload.give, shakes: [] });
    const noGive = encodeFragment({ giveSig: validPayload.giveSig, shakes: [] });
    const noShakes = encodeFragment({ give: validPayload.give, giveSig: validPayload.giveSig });
    for (const bad of [noSig, noGive, noShakes]) {
      expect(parseGiveMessage(`https://ahand.example/h/7/thank#${bad}`)).toBeNull();
    }
  });

  it("rejects non-string content (reactions, attachments, undefined)", () => {
    expect(parseGiveMessage(undefined)).toBeNull();
    expect(parseGiveMessage(null)).toBeNull();
    expect(parseGiveMessage({ some: "object" })).toBeNull();
  });

  it("takes the LAST thank-link, so a link quoted in the note can't shadow the proof", () => {
    const decoy = encodeFragment({ give: { handId: "999" }, giveSig: "0xdead", shakes: [] });
    const text = `like this one https://ahand.example/h/999/thank#${decoy}\n\n${solveUrl}`;
    const parsed = parseGiveMessage(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.handId).toBe("7");
    expect(parsed!.fragment).toBe(fragment);
  });

  it("refuses oversized messages outright (hostile-input bound)", () => {
    const huge = "a".repeat(9000) + " " + solveUrl;
    expect(parseGiveMessage(huge)).toBeNull();
    // and stays fast on adversarial near-miss input under the cap
    const hostile = ("https://" + "/h".repeat(120) + " ").repeat(30);
    const t0 = Date.now();
    expect(parseGiveMessage(hostile)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(200);
  });
});
