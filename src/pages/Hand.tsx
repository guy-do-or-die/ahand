import { useState } from "react";
import { useLocation } from "wouter";

import { useAccount, useBalance, useNetwork } from "wagmi";
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
  useAHandShakesChain,
  useAHandSolutionsNumber,
  useAHandSolutions,
} from "../contracts";


const Problem = ({params: {hand, ref}}) => {

  const { chain } = useNetwork()

  const {data: problem} = useAHandProblem({
    address: hand,
  })

  const {data: chainData} = useAHandShakesChain({
    address: hand,
    enabled: ref,
    args: [ref],
  });

  const {data: rewardData} = useBalance({
    address: hand,
  })

  const shakes = chainData || [];
  const reward = parseInt(rewardData?.value) || 0;

  const [baseReward, ...rewards] = shakes.reverse().reduce((acc, _, i) => {
    const amount = (i === 0 ? reward : acc[i - 1]) / 2;
    acc.push(amount);
    return acc;
  }, []);

  const potentialReward = (baseReward || reward) + (rewards.at(-1) || 0);

  return <div className="mb-8">
    <ShareMeta title={problem} reward={reward} />
    <div className="card-title text-center mb-8 text-4xl justify-center">
      {problem}
    </div>
    <div className="flex justify-center space-x-4 mb-4 shakes">
      <div className="badge badge-neutral badge-lg"> 🙌 </div>
      {rewards.map((node, i) => <div className="badge badge-neutral badge-lg" key={node}>🤝 {formatEther(rewards[i])}</div>)}
      <div className="badge badge-success badge-lg">🫵 {formatEther(potentialReward)} {chain?.nativeCurrency.symbol}</div>
    </div>
  </div>
}


const SolutionInput = ({setValue}) => {

  return <div>
    <textarea className="textarea textarea-bordered w-full" placeholder="Solution" onChange={event => setValue(event.target.value)} />
  </div>
}


const ShakeButton = ({params: {hand, ref}, newRef}) => {

  const [location, setLocation] = useLocation();

  const shakeParams = {
    args: [hand, ref, newRef],
    enabled: true,
    onReceipt: data => {
      setLocation(`/hand/${hand}/${newRef}/share`);
    }
  }

  return <Button emoji="🤝" text="Shake" 
                 prepareHook={usePrepareAHandBaseShake}
                 writeHook={useAHandBaseShake}
                 params={shakeParams} />
}


const GiveButton = ({params: {hand, ref}, newRef, solution}) => {

  const [location, setLocation] = useLocation();

  const giveParams = {
    args: [hand, ref, newRef, solution],
    enabled: solution?.length > 0,
    onReceipt: data => {
      setLocation(`/hand/${hand}/${newRef}/given`);
    }
  }

  return <Button emoji="🙌" text="Give" 
                 prepareHook={usePrepareAHandBaseGive}
                 writeHook={useAHandBaseGive}
                 params={giveParams} />
}


const ThankButton = ({hand, solutionId, ref}) => {

  const [location, setLocation] = useLocation();

  const thankParams = {
    args: [hand, solutionId],
    enabled: true,
    onReceipt: data => {
      setLocation(`/hand/${hand}/${ref}/thanked`);
    }
  }

  return <Button emoji="🙏" text="Thank" 
                 prepareHook={usePrepareAHandBaseThank}
                 writeHook={useAHandBaseThank}
                 params={thankParams} />
}


const Solution = ({hand, id, isOpen, onToggle}) => {

  const {data} = useAHandSolutions({
    address: hand,
    args: [id], 
  })

  const [giver, solution] = data || [];

  return <div key={id} className={`collapse collapse-arrow join-item border border-base-300 ${isOpen ? 'collapse-open' : ''} group`}>
    <input type="radio" name="solutions" checked={isOpen} onChange={() => onToggle(id)} />
    <div className="collapse-title text-xl font-medium relative">
      {(solution || "").substring(0, 10)}
      <div className="absolute top-2 right-10 opacity-0 group-hover:opacity-100 z-10">
        <ThankButton hand={hand} solutionId={id} ref={giver} />
      </div>
    </div>
    <div className="collapse-content">
      <div className="">{solution}</div>
    </div>
  </div>
}


const Solutions = ({hand}) => {

  const [openAccordion, setOpenAccordion] = useState(null);

  const {data: solutionsNumber} = useAHandSolutionsNumber({
    address: hand,
  })

  return <div className="join join-vertical w-full">
    { 
      [...Array(parseInt(solutionsNumber || 0)).keys()].map(id => 
        <Solution id={id} hand={hand} key={id}
                  isOpen={openAccordion === id} 
                  onToggle={id => setOpenAccordion(openAccordion === id ? null : id)} />)
    }
  </div>
}


const Shake = ({params}) => {

  const [newRef] = useState(genRef());
  const [solution, setSolution] = useState();

  return <div>
    <SolutionInput setValue={setSolution}/>
    <div className="card-actions justify-center mt-2 space-x-2">
      <ShakeButton params={params} newRef={newRef} />
      <GiveButton params={params} newRef={newRef} solution={solution} />
    </div>
  </div>

}


export const Hand = ({params}) => {

  const url = `${window.location.origin}/hand/${params.hand}/${params.ref}`;
  
  const action = params.action || "other";

  const msg = {
    "share": "Spread the hand!",
    "given": "Solution sent!",
    "thanked": "Thank you for thanking!",
  }[action];

  const el = {
    "share": <Share url={url} />,
    "other": <Shake params={params} />,
  }[action]

  return <div>
    <Problem params={params} />
    <p className="text-2xl text-gray-700 text-center">{msg}</p>
    { params.ref ? <div>{el}</div> : <Solutions hand={params.hand} /> }
  </div>
}
