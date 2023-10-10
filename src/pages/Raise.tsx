import { useState } from "react";
import { parseEther } from "viem";

import { useNetwork, useAccount, useBlockNumber } from "wagmi";

import {
  useAHandBaseHandsNumber,
  usePrepareAHandBaseRaise,
  useAHandBaseRaise,
} from "../contracts";


export const Raise = () => {

  const { chain } = useNetwork();
  const { address } = useAccount();

  const [block, setBlock] = useState(0);
  const [handsNumber, setHandsNumber] = useState(0);

  const [problem, setProblem] = useState();
  const [reward, setReward] = useState("");

  const handleRewardChange = (event) => {
    const value = event.target.value;

    if (value === '' || value === '.' || value === '0.' || (/^\d*\.?\d+$/.test(value) && parseFloat(value) >= 0)) {
      setReward(value);
    }
  };

  useBlockNumber({
    onBlock: data => setBlock(parseInt(data)),
  });

  const { data, error: prepareError } = useAHandBaseHandsNumber({
    onSettled: data => setHandsNumber(parseInt(data)),
    watch: true,
  });

  const { config, error: writeError } = usePrepareAHandBaseRaise({
    args: [problem],
    value: parseEther(reward),

    onSettled: (data, error) => {
      console.log(data);
      console.log(error);
    }
  })

  const { write } = useAHandBaseRaise(config);

  return <div>
    <div>
      <textarea className="textarea textarea-bordered w-full" placeholder="Problem" 
                onChange={event => setProblem(event.target.value)}>
      </textarea>
    </div>
    <div className="flex items-center space-x-4">
      <input type="text" placeholder="Reward" className="input input-bordered w-full max-w-xs"
             pattern="^(0*?[1-9]\d*(\.\d+)?|0*\.\d*[1-9]\d*)$"
             value={reward} onChange={handleRewardChange} />
      <button className="btn btn-ghost" disabled={!write}
              onClick={() => write?.()}>✋ Raise</button>
    </div>
  </div>
}
