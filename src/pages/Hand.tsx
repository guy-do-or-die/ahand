import { useState, useRef, useEffect } from "react";

import { useSpring, animated } from '@react-spring/web'
import { useDrag } from '@use-gesture/react'

import { useAccount, useBalance } from "wagmi";
import { formatEther } from "viem";

import { useLocation } from "wouter";

import { Button, ShareForm, ShareMeta } from "../components";
import { genRef } from "../utils";

import {
  useReadAHandProblem,
  useReadAHandShakesChain,
  useReadAHandRaiser,
  useReadAHandSolutionsNumber,
  useReadAHandSolutions,
  useSimulateAHandBaseShake,
  useSimulateAHandBaseGive,
  useSimulateAHandBaseThank,
  useWriteAHandBaseShake,
  useWriteAHandBaseGive,
  useWriteAHandBaseThank,
} from "../contracts";


const Problem = ({params: {hand, ref}, action}) => {

  const {data: problem} = useReadAHandProblem({
    address: hand,
  })

  const {data: rewardData} = useBalance({
    address: hand,
  })

  const reward = parseInt(rewardData?.value) || 0;

  return <div className="mb-8">
    <ShareMeta title={problem} reward={reward} />
    <div className="card-title text-center mb-8 text-xl md:text-2xl lg:text-3xl justify-center">
      {problem}
    </div>
    <Shakes hand={hand} shakeRef={ref} reward={reward} action={action} />
  </div>
}


const Shake = ({children, classes = 'badge-neutral'}) => {
  return (
    <div className={`badge badge-lg h-8 ${classes}`}>
      {children}
    </div>
  );
};


const Shakes = ({hand, shakeRef, reward, action}) => {

  const { chain } = useAccount()

  const {data: shakesData} = useReadAHandShakesChain({
    address: hand,
    enabled: shakeRef,
    args: [shakeRef],
  });

  const shakes = shakesData || [];

  const [baseReward, ...rewards] = shakes.reduce((acc, _, i) => {
    const amount = (i === 0 ? reward : acc[i - 1]) / 2;
    acc.push(amount);
    return acc;
  }, []);

  const potentialReward = (baseReward || reward) + (rewards.at(-1) || 0);

  const lastIcon = {
    "given": "🙌",
    "thanked": "🙏",
  }[action] || "🫵"

  const shakesRef = useRef(null);

  const [{ x, y }, set] = useSpring(() => ({ x: 0, y: 0 }));
  const drag = useDrag(({ offset: [dx] }) => {
    if (shakesRef.current) {
      shakesRef.current.scrollLeft = -dx;
    }
  });

  useEffect(() => {
    if (shakesRef.current) {
      shakesRef.current.scrollLeft = shakesRef.current.scrollWidth;
    }
  }, []);

  return <>
    <div className="flex justify-center mb-4 shakes">
      <div ref={shakesRef} {...drag()} style={{ x, y, touchAction: 'none' }}
           className="flex overflow-x-scroll no-scrollbar select-none">
        <div className="flex-shrink-0 space-x-4 m-auto">
          <Shake classes="badge-neutral !ml-4">✋</Shake>
          {rewards.reverse().map((reward, i) => (
            <Shake key={i}>🤝 {formatEther(reward)}</Shake>
          ))}
          <Shake classes="badge-success !mr-4">
            {lastIcon} {formatEther(potentialReward)} {chain?.nativeCurrency.symbol}
          </Shake>
        </div>
      </div>
    </div>
  </>
}


const SolutionInput = ({setValue}) => {

  return <div className="lg:tooltip w-full h-48 md:h-32" data-tip="Provide your comment, solution or contacts">
    <textarea className="textarea textarea-bordered w-full resize-none lg:resize-y min-h-32 h-48 md:h-32" placeholder="Comment or Solution" onChange={event => setValue(event.target.value)} />
  </div>
}


const ShakeButton = ({params: {hand, ref}, newRef}) => {

  const [location, setLocation] = useLocation();

  const shakeParams = {
    args: [hand, ref, newRef],
    enabled: true,
    onConfirmationSuccess: data => {
      setLocation(`/hand/${hand}/${newRef}/share`);
    }
  }

  return <Button emoji="🤝" text="Shake" 
                 simulateHook={useSimulateAHandBaseShake}
                 writeHook={useWriteAHandBaseShake}
                 params={shakeParams} />
}


const GiveButton = ({params: {hand, ref}, newRef, solution}) => {

  const [location, setLocation] = useLocation();

  const giveParams = {
    args: [hand, ref, newRef, solution],
    enabled: solution?.length > 0,
    onConfirmationSuccess: data => {
      setLocation(`/hand/${hand}/${ref}/given`);
    }
  }

  return <Button emoji="🙌" text="Give" 
                 simulateHook={useSimulateAHandBaseGive}
                 writeHook={useWriteAHandBaseGive}
                 params={giveParams} />
}


const ThankButton = ({hand, solutionId, giverRef}) => {

  const [location, setLocation] = useLocation();

  const thankParams = {
    args: [hand, solutionId],
    enabled: true,
    onConfirmationSuccess: data => {
      setLocation(`/hand/${hand}/${giverRef}/thanked`);
    }
  }

  return <Button emoji="🙏" text="Thank" 
                 simulateHook={useSimulateAHandBaseThank}
                 writeHook={useWriteAHandBaseThank}
                 params={thankParams} />
}


const Solution = ({hand, id, isOpen, onToggle}) => {

  const {data} = useReadAHandSolutions({
    address: hand,
    args: [id], 
  })

  const [giver, solution] = data || [];

  return <div key={id} className={`collapse collapse-arrow join-item border border-base-300 ${isOpen ? 'collapse-open' : ''} group`}>
    <input type="radio" name="solutions" checked={isOpen} onChange={() => onToggle(id)} />
    <div className="collapse-title text-xl font-medium relative">
      {(solution || "").substring(0, 10)}
      <div className="absolute top-2 right-10 opacity-0 group-hover:opacity-100 z-10">
        <ThankButton hand={hand} solutionId={id} giverRef={giver} />
      </div>
    </div>
    <div className="collapse-content">
      <div className="">{solution}</div>
    </div>
  </div>
}


const Solutions = ({hand}) => {

  const [openAccordion, setOpenAccordion] = useState(null);

  const {data: solutionsNumber} = useReadAHandSolutionsNumber({
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


const ShakeForm = ({params}) => {

  const [newRef] = useState(genRef());
  const [solution, setSolution] = useState();

  return <div>
    <SolutionInput setValue={setSolution}/>
    <div className="card-actions justify-center mt-2 space-x-2">
      <div className="lg:tooltip" data-tip="Just share the problem to your peers and get rewarded if someone else provides a solution">
        <ShakeButton params={params} newRef={newRef} />
      </div>
      <div className="lg:tooltip" data-tip="Deliver privately to the problem's raiser"> 
        <GiveButton params={params} newRef={newRef} solution={solution} />
      </div>
    </div>
  </div>

}


export const Hand = ({params}) => {

  const [location, setLocation] = useLocation();

  const url = `${window.location.origin}/hand/${params.hand}/${params.ref}`;
  
  const {address} = useAccount()
  const {data: raiser } = useReadAHandRaiser({
    address: params.hand,
  })

  address === raiser && !params.action && setLocation(`/hand/${params.hand}`)

  const action = params.action || "other";

  const msg = {
    "share": "Spread the hand!",
    "given": "Solution sent!",
    "thanked": "Thank you for thanking!",
  }[action];

  const el = {
    "share": <ShareForm url={url} />,
    "other": <ShakeForm params={params} />,
  }[action]

  return <div>
    <Problem params={params} action={action} />
    <p className="text-2xl text-gray-700 text-center">{msg}</p>
    { params.ref ? <div>{el}</div> : <Solutions hand={params.hand} /> }
  </div>
}
