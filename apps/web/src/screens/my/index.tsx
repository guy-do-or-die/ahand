import type { ScreenProps } from "../../routes";
import { MyAnswers } from "../give/Mine";
import { ThanksOnWay } from "./Answer";
import HandPage from "./HandPage";
import MyList from "./List";

/**
 * My hands: `/my`, the Hands raised on this device, the thanks it sent that are
 * still on their way, and the answers it sent with their threads; `/my/<chain>/<hand>`, one Hand
 * with its link again and its answers. The device's store is the list's one source; no
 * log is read to find a raiser's Hands.
 */
export default function MyScreen({ params }: ScreenProps) {
  const chain = params.chain;
  const hand = params.hand;
  return (
    <section className="mx-auto w-full max-w-[720px] px-6 py-10 md:px-10" data-screen="my">
      {chain && hand ? (
        <HandPage chainId={Number(chain)} handId={BigInt(hand)} />
      ) : (
        <div className="flex flex-col gap-8">
          <MyList />
          <ThanksOnWay />
          <MyAnswers />
        </div>
      )}
    </section>
  );
}
