import { useState } from "react";

import { useBalance } from "wagmi";
import { formatEther } from "viem";

import { Button } from "../components";
import { genRef } from "../utils";

import {
  useAHandProblem,
  usePrepareAHandBaseShake,
  usePrepareAHandBaseGive,
  useAHandBaseShake,
  useAHandBaseGive,
  useAHandShakenEvent,
  useAHandGivenEvent,
} from "../contracts";


export const Hand = ({params}) => {

  const {data: reward} = useBalance({
    address: params.hand,
  })

  const {data: problem} = useAHandProblem({
    address: params.hand,
  })

  const [solution, setSolution] = useState();

  const newRef = genRef();

  const shakeParams = {
    args: [params.hand, params.ref, newRef],
  }

  const giveParams = {
    args: [params.hand, params.ref, newRef, solution],
    enabled: solution?.length > 0,
  }

  useAHandShakenEvent({
    address: params.hand,
    listener(log) {
      (log || []).every(item => {
        const {shaker} = item.args;

        if (shaker === address) {
          setLocation(`/hand/${hand}/${ref}/share`);
          return
        }
      })
    }
  });

  useAHandGivenEvent({
    address: params.hand,
    listener(log) {
      (log || []).every(item => {
        const {giver} = item.args;

        if (giver === address) {
          setLocation(`/hand/${hand}/${ref}/share`);
          return
        }
      })
    }
  });

  return <div className="min-h-full text-center">
    <div className="text-5xl">
      {problem}
    </div>
    <div>
      {formatEther(reward || 0)}
    </div>
    <div>
      <textarea className="textarea textarea-bordered w-full" placeholder="Solution"
                onChange={event => setSolution(event.target.value)}>
      </textarea>
    </div>
    <div className="flex items-center space-x-4">
      <Button prepareHook={usePrepareAHandBaseShake} writeHook={useAHandBaseShake} params={shakeParams} emoji="🤝" text="Shake" />
      <Button prepareHook={usePrepareAHandBaseGive} writeHook={useAHandBaseGive} params={giveParams} emoji="🙌" text="Give" />
    </div>
  </div>
}
