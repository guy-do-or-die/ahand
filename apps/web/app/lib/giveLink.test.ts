import { describe, it, expect } from "vitest";
import { keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildTerminalProof,
  decodeTerminalProof,
  giveHash,
  newCapability,
  routeHashOf,
  signGive,
  signGiverAcceptance,
  solutionCommitment,
  solutionSaltRef,
  verifySolutionNote,
  type Give,
} from "@ahand/sdk";
import { buildGiveMessage, parseGiveMessage, thankPathFor } from "./giveLink";

const CHAIN_ID = 31337n;
const CORE = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as `0x${string}`;
const EXPIRY = 2_000_000_000n;

/** A real zero-shake terminal proof. */
async function mintProof(
  handId: bigint,
  solutionHash = keccak256(stringToHex("I can sublet you my flat in July.")),
  evidence?: Uint8Array[],
): Promise<string> {
  const root = newCapability();
  const giver = newCapability();
  const handRef = { chainId: CHAIN_ID, core: CORE, handId };
  const give: Give = {
    handId,
    routeHash: routeHashOf(handRef, []),
    giver: giver.address,
    solutionHash,
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
    evidence,
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

describe("sealed words survive delivery", () => {
  /** As useSolveFlow seals: fresh salt, salt ref only on the delivered link. */
  async function seal(text: string) {
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const hash = solutionCommitment(text, salt);
    return {
      hash,
      noteUrl: `https://ahand.example/h/7/thank#${await mintProof(7n, hash, [solutionSaltRef(salt)])}`,
      solveUrl: `https://ahand.example/h/7/thank#${await mintProof(7n, hash)}`,
    };
  }

  /** What the raiser's thank page decides for a received message. */
  function verdict(message: string): boolean {
    const parsed = parseGiveMessage(message);
    expect(parsed).not.toBeNull();
    const proof = decodeTerminalProof(parsed!.fragment, {
      handRef: { chainId: CHAIN_ID, core: CORE, handId: 7n },
      expiry: EXPIRY,
      rootCapability: "0x0000000000000000000000000000000000000001",
    });
    return verifySolutionNote(parsed!.note, proof.give.give.solutionHash, proof.evidence);
  }

  it.each([
    ["plain", "I can help"],
    ["trailing Enter", "I can help\n"],
    ["leading spaces", "  I can help"],
    ["mobile keyboard trailing space", "I can help "],
    ["no-break space", "I can help\u00a0"],
    ["CRLF inside and at the edge", "line one\r\nline two\r\n"],
    ["emoji", "on my way 🙌 "],
    ["NFD", "Cafe\u0301 at 5"],
  ])("verifies a note typed with %s", async (_, text) => {
    const { noteUrl } = await seal(text);
    expect(verdict(buildGiveMessage({ solveUrl: noteUrl, solutionText: text }))).toBe(true);
  });

  it("gives the same words a different seal every time", async () => {
    const a = await seal("yes");
    const b = await seal("yes");
    expect(a.hash).not.toBe(b.hash);
    expect(a.hash).not.toBe(keccak256(stringToHex("yes")));
  });

  it("keeps the salt off the link that is copied or shared on its own", async () => {
    const { solveUrl, noteUrl } = await seal("yes");
    expect(noteUrl.length).toBeGreaterThan(solveUrl.length);
    expect(verdict(buildGiveMessage({ solveUrl, solutionText: "yes" }))).toBe(false);
  });

  it("flags edited words as unverified", async () => {
    const { noteUrl } = await seal("I can help");
    expect(verdict(buildGiveMessage({ solveUrl: noteUrl, solutionText: "I can't help" }))).toBe(false);
  });
});
