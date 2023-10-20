import { useState } from "react";

import { useAccount, useBalance } from "wagmi";
import { formatEther } from "viem";

import { Button, Share, ShareMeta } from "../components";
import { genRef } from "../utils";

import {
  useAHandProblem,
  usePrepareAHandBaseShake,
  usePrepareAHandBaseGive,
  usePrepareAHandBaseThank,
  useAHandBaseShake,
  useAHandBaseGive,
  useAHandBaseThank,
  useAHandShakenEvent,
  useAHandGivenEvent,
  useAHandThankedEvent,
  useAHandShakesChain,
  useAHandSolutionsNumber,
  useAHandSolutions,
} from "../contracts";


const Problem = ({hand}) => {

  const {data: problem} = useAHandProblem({
    address: hand,
  })

  const {address} = useAccount();

  const {data: chainData} = useAHandShakesChain({
    address: hand,
    args: [address],
  });

  const {data: rewardData} = useBalance({
    address: hand,
  })

  const chain = chainData || [];
  const reward = formatEther(rewardData || 0);

  return <>
    <ShareMeta title={problem} reward={reward} />
    <div className="text-5xl">
      {problem}
    </div>
    <div className="flex items-center space-x-2">
      {chain.map(node => <div key={node}>👹</div>)}
    </div>
  </>
}


const SolutionInput = ({setValue}) => {

  return <div>
    <textarea className="textarea textarea-bordered w-full" placeholder="Solution" onChange={event => setValue(event.target.value)} />
  </div>
}


const ShakesChain = ({hand}) => {

  return 

}


const ShakeButton = ({params: {hand, ref}, newRef}) => {

  const {address} = useAccount();

  const shakeParams = {
    args: [hand, ref, newRef],
    enabled: true,
  }

  useAHandShakenEvent({
    address: hand,
    listener(log) {
      (log || []).every(item => {
        const {shaker} = item.args;

        if (shaker === address) {
          setLocation(`/hand/${hand}/${newRef}/share`);
          return
        }
      })
    }
  });

  return <Button emoji="🤝" text="Shake" 
            prepareHook={usePrepareAHandBaseShake}
            writeHook={useAHandBaseShake}
            params={shakeParams} />
}


const GiveButton = ({params: {hand, ref}, newRef, solution}) => {

  const {address} = useAccount();

  const giveParams = {
    args: [hand, ref, newRef, solution],
    enabled: solution?.length > 0,
  }

  useAHandGivenEvent({
    address: hand,
    listener(log) {
      (log || []).every(item => {
        const {giver} = item.args;

        if (giver === address) {
          setLocation(`/hand/${hand}/${newRef}/share`);
          return
        }
      })
    }
  });

  return <Button emoji="🙌" text="Give" 
            prepareHook={usePrepareAHandBaseGive}
            writeHook={useAHandBaseGive}
            params={giveParams} />
}


const ThankButton = ({hand, solutionId}) => {

  const {address} = useAccount();

  const thankParams = {
    args: [hand, solutionId],
    enabled: true,
  }

  useAHandThankedEvent({
    address: hand,
    listener(log) {
      (log || []).every(item => {
        const {thanker} = item.args;

        if (thanker === address) {
          setLocation(`/hand/${hand}/${newRef}/share`);
          return
        }
      })
    }
  });

  return <Button emoji="🙏" text="Thank" 
            prepareHook={usePrepareAHandBaseThank}
            writeHook={useAHandBaseThank}
            params={thankParams} />
}


const Solution = ({hand, id}) => {

  const {data} = useAHandSolutions({
    address: hand,
    args: [id], 
  })

  const [giver, solution] = data || [];

  return <div key={id} className="mb-2">
    <div className="h-24">
      <div className="">{solution}</div>
      <div className="">
        <ThankButton hand={hand} solutionId={id} />
      </div>
    </div>
  </div>
}


const Solutions = ({hand}) => {

  const {data: solutionsNumber} = useAHandSolutionsNumber({
    address: hand,
  })

  return <div>
    { [...Array(parseInt(solutionsNumber || 0)).keys()].map(id => <Solution id={id} hand={hand} key={id} />) }
  </div>
}


export const Hand = ({params}) => {

  const [solution, setSolution] = useState();
  const [newRef] = useState(genRef());

  const url = `${window.location.origin}/${params.hand}/${params.ref}`;

  return <div className="min-h-full text-center">
    <Problem hand={params.hand} />
    <ShakesChain hand={params.hand} />
    { 
      params.ref ?
        <div className="m-2">
          { 
            params.action === "share" ?
              <Share url={url} />
                :
              <div>
                <SolutionInput setValue={setSolution}/>
                <div className="flex items-center space-x-4">
                  <ShakeButton params={params} newRef={newRef} />
                  <GiveButton params={params} newRef={newRef} solution={solution} />
                </div>
              </div>
          }
        </div>
          :
        <Solutions hand={params.hand} />
    }
  </div>
}
