import { describe, it, expect } from "vitest";
import { keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildTerminalProof,
  giveHash,
  newCapability,
  routeHashOf,
  signGive,
  signGiverAcceptance,
  type Give,
} from "@ahand/sdk";
import { buildGiveMessage, parseGiveMessage, thankPathFor } from "./giveLink";

const CHAIN_ID = 31337n;
const CORE = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as `0x${string}`;
const EXPIRY = 2_000_000_000n;

/** A real zero-shake terminal proof, exactly as useSolveFlow mints one. */
async function mintProof(handId: bigint): Promise<string> {
  const root = newCapability();
  const giver = newCapability();
  const handRef = { chainId: CHAIN_ID, core: CORE, handId };
  const give: Give = {
    handId,
    routeHash: routeHashOf(handRef, []),
    giver: giver.address,
    solutionHash: keccak256(stringToHex("I can sublet you my flat in July.")),
    finalClaimBps: 10_000,
    deadline: EXPIRY,
  };
  const giveSig = await signGive(give, root.privateKey, CHAIN_ID, CORE);
  const giverAcceptanceSig = await signGiverAcceptance(
    giveHash(give),
    privateKeyToAccount(giver.privateKey),
    CHAIN_ID,
    CORE,
  );
  return buildTerminalProof({
    handRef,
    expiry: EXPIRY,
    rootCapability: root.address,
    shakes: [],
    give: { give, signature: giveSig },
    giverAcceptanceSig,
  });
}

const fragment = await mintProof(7n);
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

  it("parses links minted on any origin and rebuilds a local path", async () => {
    const foreignFragment = await mintProof(42n);
    const foreign = `https://abc123.ngrok-free.app/h/42/thank#${foreignFragment}`;
    const parsed = parseGiveMessage(foreign);
    expect(parsed).not.toBeNull();
    expect(thankPathFor(parsed!)).toBe(`/h/42/thank#${foreignFragment}`);
  });

  it("rejects plain chatter and foreign links", () => {
    expect(parseGiveMessage("gm, how's the hand going?")).toBeNull();
    expect(parseGiveMessage("https://example.com/some/other/link")).toBeNull();
    expect(parseGiveMessage(`https://ahand.example/h/7#${fragment}`)).toBeNull();
  });

  it("rejects a thank link whose fragment is not a terminal proof", () => {
    expect(parseGiveMessage("https://ahand.example/h/7/thank#notbase64!!!")).toBeNull();
    expect(parseGiveMessage("https://ahand.example/h/7/thank#YWJjZGVm")).toBeNull(); // "abcdef"
    // a structurally valid JSON blob from the previous protocol is refused
    const legacy = btoa(JSON.stringify({ give: {}, giveSig: "0x", shakes: [] }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(parseGiveMessage(`https://ahand.example/h/7/thank#${legacy}`)).toBeNull();
  });

  it("rejects a proof whose path hand does not match its header", () => {
    // the same valid fragment presented under a different hand id
    expect(parseGiveMessage(`https://ahand.example/h/8/thank#${fragment}`)).toBeNull();
  });

  it("rejects a truncated proof", () => {
    expect(
      parseGiveMessage(`https://ahand.example/h/7/thank#${fragment.slice(0, fragment.length - 8)}`),
    ).toBeNull();
  });

  it("rejects non-string content (reactions, attachments, undefined)", () => {
    expect(parseGiveMessage(undefined)).toBeNull();
    expect(parseGiveMessage(null)).toBeNull();
    expect(parseGiveMessage({ some: "object" })).toBeNull();
  });

  it("takes the LAST thank-link, so a link quoted in the note can't shadow the proof", () => {
    const text = `like this one https://ahand.example/h/999/thank#YWJjZGVm\n\n${solveUrl}`;
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
