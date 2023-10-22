import { useState } from "react";
import { parseEther } from "viem";
import { useLocation } from "wouter";

import { useAccount, useNetwork, useBlockNumber } from "wagmi";

import { Button } from "../components";
import { genRef } from "../utils";

import {
  usePrepareAHandBaseRaise,
  useAHandBaseRaise,
  useAHandBaseRaisedEvent,
} from "../contracts";


export const Raise = () => {

  const {address} = useAccount();
  const {chain} = useNetwork();

  const [location, setLocation] = useLocation();

  const [block, setBlock] = useState(0);

  const [problem, setProblem] = useState();
  const [reward, setReward] = useState("");

  const handleRewardChange = (event) => {
    const value = event.target.value;

    if (
      value === ''
      || value === '.'
      || value === '0.'
      || (/^\d*\.?\d+$/.test(value) && parseFloat(value) >= 0)
    ) {
      setReward(value);
    }
  };

  const [ref, setRef] = useState(genRef());

  const raiseParams = {
    args: [problem, ref],
    value: parseEther(reward),
    enabled: problem?.length > 0 && parseFloat(reward) > 0,
  };

  useAHandBaseRaisedEvent({
    listener(log) {
      (log || []).every(item => {
        const {hand, raiser} = item.args;

        if (raiser === address) {
          setLocation(`/hand/${hand}/${ref}/share`);
          return
        }
      })
    }
  });

  return <div>
    <div>
      <textarea className="textarea textarea-bordered w-full" placeholder="Problem" onChange={event => setProblem(event.target.value)} />
    </div>
    <div className="card-actions justify-center mt-2">
      <input type="text" placeholder="Reward" className="input input-bordered w-full max-w-xs"
             pattern="^(0*?[1-9]\d*(\.\d+)?|0*\.\d*[1-9]\d*)$" value={reward} onChange={handleRewardChange} />

      <Button emoji="✋" text="Raise"
              prepareHook={usePrepareAHandBaseRaise}
              writeHook={useAHandBaseRaise}
              params={raiseParams} />
    </div>
  </div>
}
