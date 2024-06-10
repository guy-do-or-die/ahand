import { useState, useEffect } from "react";
import { parseEther } from "viem";
import { useLocation } from "wouter";

import { useAccount, useBlockNumber } from "wagmi";

import { usePrivy } from "@privy-io/react-auth";

import { Button, notify } from "../components";
import { genRef } from "../utils";

import {
  useSimulateAHandBaseRaise,
  useWriteAHandBaseRaise,
  useWatchAHandBaseRaisedEvent,
} from "../contracts";


export const Raise = () => {

  const {ready, authenticated} = usePrivy();

  const {address, chain} = useAccount();

  const [location, setLocation] = useLocation();

  const [block, setBlock] = useState(0);

  const [problem, setProblem] = useState();
  const [reward, setReward] = useState("");

  useEffect(() => {
    !ready || !authenticated && setLocation("/");
  }, [ready, authenticated])

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

  useWatchAHandBaseRaisedEvent({
    onError(error) {
      console.log(error.message)
    },
    onLogs(logs) {
      (logs || []).every(item => {
        const {hand, raiser} = item.args;

        if (raiser === address) {
          setLocation(`/hand/${hand}/${ref}/share`);
          return
        }
      })
    }
  });

  return <div>
    <div className="lg:tooltip w-full h-48 md:h-32" data-tip="Type or paste a link to your problem description">
      <textarea className="textarea textarea-bordered w-full resize-none lg:resize-y min-h-32 h-48 md:h-32" placeholder="Problem" onChange={event => setProblem(event.target.value)} />
    </div>
    <div className="card-actions justify-center mt-2">
      <div className="lg:tooltip w-full max-w-xs" data-tip="Set fair reward for a solution participants">
        <input type="text" placeholder="Reward" className="input input-bordered w-full"
               pattern="^(0*?[1-9]\d*(\.\d+)?|0*\.\d*[1-9]\d*)$" value={reward} onChange={handleRewardChange} />
      </div>

      <div className="lg:tooltip" data-tip="Publish your problem">
        <Button emoji="✋" text="Raise"
                simulateHook={useSimulateAHandBaseRaise}
                writeHook={useWriteAHandBaseRaise}
                params={raiseParams} />
      </div>
    </div>
  </div>
}
