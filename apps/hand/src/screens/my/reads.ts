/**
 * Whether each relay has answered a read of an inbox. "No answers yet" is true only after one,
 * and the transport of packages/deliver does not say, so the WebSocket it is given is watched:
 * a `REQ` it sends names the inbox key it asks for (`#p`), the relay's `EOSE` for that
 * subscription ends the stored messages (NIP-01), and a socket that closes first could not be
 * read. The watching class changes nothing the transport sends or receives.
 */

export interface ReadMarks {
  /** Relays that answered a read of this inbox in full. */
  read: number;
  /** Relays that could not be reached, or dropped the connection before answering in full. */
  failed: number;
}

export interface ReadBook {
  /** The WebSocket to hand to the transport in place of the global one. */
  Socket: typeof WebSocket;
  /** Starts keeping marks for an inbox key (hex, with or without 0x). */
  expect(inbox: string): void;
  /** Undefined for a key that was never expected. */
  marksOf(inbox: string): ReadMarks | undefined;
}

const bare = (key: string) => key.replace(/^0x/i, "").toLowerCase();

function frame(data: unknown): unknown[] | undefined {
  if (typeof data !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** A book of reads over sockets of class `Base`; `onChange` is called whenever a mark changes. */
export function readBook(Base: typeof WebSocket, onChange: () => void): ReadBook {
  // inbox key → relay → how its read stands. A read that happened stays one: a relay that drops
  // the connection later is reconnected by the transport, and has already said what it kept.
  const marks = new Map<string, Map<string, "read" | "failed">>();
  const mark = (inbox: string, relay: string, state: "read" | "failed") => {
    const of = marks.get(inbox);
    if (!of || of.get(relay) === "read" || of.get(relay) === state) return;
    of.set(relay, state);
    onChange();
  };

  class Watched extends Base {
    /** Subscription id → the inbox key it asks for, until the relay has answered it in full. */
    readonly #asked = new Map<string, string>();
    #opened = false;

    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      const relay = String(url);
      this.addEventListener("open", () => {
        this.#opened = true;
      });
      this.addEventListener("message", (event) => {
        const message = frame((event as MessageEvent).data);
        if (message?.[0] !== "EOSE" || typeof message[1] !== "string") return;
        const inbox = this.#asked.get(message[1]);
        if (inbox === undefined) return;
        this.#asked.delete(message[1]);
        mark(inbox, relay, "read");
      });
      this.addEventListener("close", () => {
        // Never opened: the relay is out of reach, for every inbox still unread there.
        // Opened: only what this socket asked and did not get answered in full.
        for (const inbox of this.#opened ? this.#asked.values() : marks.keys()) mark(inbox, relay, "failed");
      });
    }

    override send(data: Parameters<WebSocket["send"]>[0]): void {
      const message = frame(data);
      const keys = message?.[0] === "REQ" && typeof message[1] === "string" ? (message[2] as { "#p"?: unknown } | undefined)?.["#p"] : undefined;
      if (Array.isArray(keys) && typeof keys[0] === "string") this.#asked.set(message![1] as string, bare(keys[0]));
      super.send(data);
    }
  }

  return {
    Socket: Watched,
    expect(inbox) {
      if (!marks.has(bare(inbox))) marks.set(bare(inbox), new Map());
    },
    marksOf(inbox) {
      const of = marks.get(bare(inbox));
      if (!of) return undefined;
      const states = [...of.values()];
      return { read: states.filter((state) => state === "read").length, failed: states.filter((state) => state === "failed").length };
    },
  };
}
