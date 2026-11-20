import type { ScreenProps } from "../../routes";
import HandPage from "./HandPage";
import MyList from "./List";

/**
 * My hands (UX-SPEC §7.3): `/my`, the Hands raised on this device, and `/my/<chain>/<hand>`, one
 * of them with its link again and its answers. The device's store is the list's one source; no
 * log is read to find a raiser's Hands (D-5).
 */
export default function MyScreen({ params }: ScreenProps) {
  const chain = params.chain;
  const hand = params.hand;
  return (
    <section className="mx-auto w-full max-w-[720px] px-6 py-10 md:px-10" data-screen="my">
      {chain && hand ? <HandPage chainId={Number(chain)} handId={BigInt(hand)} /> : <MyList />}
    </section>
  );
}
