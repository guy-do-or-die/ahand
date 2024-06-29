import { useState, useRef, useEffect } from "react"

import { useSpring, animated } from '@react-spring/web'
import { useDrag } from '@use-gesture/react'

import { useBalance } from "wagmi"
import { formatEther } from "viem"

import { useLocation } from "wouter"

import { Button, ShareForm, ShareMeta } from "../components"
import { useAccount } from "../wallet"
import { genRef } from "../utils"

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
} from "../contracts"

import { useConfig } from '../Store'


const Problem = ({params: {hand, ref}, action}) => {

  const {data: problem} = useReadAHandProblem({
    address: hand,
  })

  const {data: rewardData} = useBalance({
    address: hand,
  })

  const reward = parseInt(rewardData?.value) || 0

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
  )
}


const Shakes = ({hand, shakeRef, reward, action}) => {

  const { chain } = useAccount()

  const {data: shakesData} = useReadAHandShakesChain({
    address: hand,
    enabled: shakeRef,
    args: [shakeRef],
  })

  const shakes = shakesData || []

  const [baseReward, ...rewards] = shakes.reduce((acc, _, i) => {
    const amount = (i === 0 ? reward : acc[i - 1]) / 2
    acc.push(amount)
    return acc
  }, [])

  const potentialReward = (baseReward || reward) + (rewards.at(-1) || 0)

  const lastIcon = {
    "given": "🙌",
    "thanked": "🙏",
  }[action] || "🫵"

  const shakesRef = useRef(null)

  const [{ x, y }, set] = useSpring(() => ({ x: 0, y: 0 }))
  const drag = useDrag(({ offset: [dx] }) => {
    if (shakesRef.current) {
      shakesRef.current.scrollLeft = -dx
    }
  })

  useEffect(() => {
    if (shakesRef.current) {
      shakesRef.current.scrollLeft = shakesRef.current.scrollWidth
    }
  }, [rewards])

  return <>
    <div className="flex justify-center mb-4 shakes">
      <div ref={shakesRef} {...drag()} style={{ x, y, touchAction: 'none' }}
           className="flex overflow-x-scroll no-scrollbar select-none">
        <div className="flex-shrink-0 space-x-4 m-auto">
          <Shake classes="badge-neutral badge-lg !ml-4">✋</Shake>
          {rewards.reverse().map((reward, i) => (
            <Shake key={i}>🤝 {formatEther(reward)}</Shake>
          ))}
          <Shake classes="badge-success badge-lg !mr-4">
            {lastIcon} {formatEther(potentialReward)} {chain?.nativeCurrency.symbol}
          </Shake>
        </div>
      </div>
    </div>
  </>
}


const SolutionInput = ({solution, setSolution, encrypted, setEncrypted}) => {

  const {config} = useConfig()

  const {connected, login} = useAccount()

  const onClick = () => !connected && login() 

  return <div className="lg:tooltip w-full h-48 md:h-32 relative" data-tip="Provide your comment, solution or contacts">
    <textarea className="textarea textarea-bordered w-full resize-none lg:resize-y min-h-32 h-48 md:h-32" name="solution" placeholder="Comment or Solution"
              value={solution} onChange={event => setSolution(event.target.value)} onClick={onClick}/>
    <div className={`absolute -top-4 right-3 ${config.theme === "dark" ? "bg-black" : "bg-white"}`}>
      <label className="label cursor-pointer p-1">
        <input className="checkbox checkbox-xs" type="checkbox" checked={encrypted ? "checked" : ""} onChange={() => setEncrypted(!encrypted)}/>
        <span className="label-text font-bold mt-1 ml-1">Private</span>
      </label>
    </div>
  </div>
}


const ShakeButton = ({params: {hand, ref}, newRef, comment}) => {

  const [location, setLocation] = useLocation()

  const {connected} = useAccount()

  const shakeParams = {
    args: [hand, ref, newRef, comment],
    enabled: connected,
    onConfirmationSuccess: data => {
      setLocation(`/hand/${hand}/${newRef}/share`)
    }
  }

  return <Button emoji="🤝" text="Shake" 
                 simulateHook={useSimulateAHandBaseShake}
                 writeHook={useWriteAHandBaseShake}
                 params={shakeParams} />
}


const GiveButton = ({params: {hand, ref}, newRef, solution}) => {

  const [location, setLocation] = useLocation()

  const giveParams = {
    args: [hand, ref, newRef, solution],
    enabled: solution?.length > 0,
    onConfirmationSuccess: data => {
      setLocation(`/hand/${hand}/${ref}/given`)
    }
  }

  return <Button emoji="🙌" text="Give" 
                 simulateHook={useSimulateAHandBaseGive}
                 writeHook={useWriteAHandBaseGive}
                 params={giveParams} />
}


const ThankButton = ({hand, giverRef, solutionId, thankRate, charity, charityRate, maint, maintRate, comment}) => {

  const [location, setLocation] = useLocation()

  const thankParams = {
    args: [hand, solutionId, thankRate * 100, charity, charityRate * 100, maint, maintRate * 100, comment],
    enabled: true,
    onConfirmationSuccess: data => {
      setLocation(`/hand/${hand}/${giverRef}/thanked`)
    }
  }

  return <Button emoji="🙏" text="Thank" 
                 simulateHook={useSimulateAHandBaseThank}
                 writeHook={useWriteAHandBaseThank}
                 params={thankParams} />
}


const Slider = ({ label, value, min=0, max=100, onChange }) => {
  
  const onChangeLimited = value => onChange(Math.min(max, Math.max(min, value)));

  return (
    <div className="flex items-center">
      <label className="input input-sm flex items-center w-20">
        <label className="label-text font-bold">{label}:</label>
      </label>
      <div className="relative w-16">
        <input type="number" min={min} max={max} value={value} className="pr-4 w-12 text-right"
               onChange={(e) => onChangeLimited(Number(e.target.value))} />
        <span className="absolute top-0 right-5 text-gray-500">%</span>
      </div>
      <input type="range" min={min} max={max} value={value} className="range range-xs flex-1 mr-3"
             onChange={(e) => onChangeLimited(Number(e.target.value))} />
    </div>
  )
}


const Solution = ({hand, id, isOpen, onToggle}) => {

  const {config} = useConfig()

  const {data} = useReadAHandSolutions({
    address: hand,
    args: [id], 
  })

  const [giver, solution] = data || []

  const [thankRate, setThankRate] = useState(100)

  const [charity, setCharity] = useState('0x830bc5551e429DDbc4E9Ac78436f8Bf13Eca8434')
  const [charityRate, setCharityRate] = useState(2)

  const [maint, setMaint] = useState('0x830bc5551e429DDbc4E9Ac78436f8Bf13Eca8434')
  const [maintRate, setMaintRate] = useState(1)

  const [comment, setComment] = useState("")

  const charityOptions = [
    { label: 'Shaoline', value: '0x830bc5551e429DDbc4E9Ac78436f8Bf13Eca8434' },
    { label: 'Ukraine', value: '0x830bc5551e429DDbc4E9Ac78436f8Bf13Eca8434' },
  ]

  const charitySelector = "Charity" 

  const titleColor = config.theme === "dark" ? "bg-neutral-900" : "bg-neutral-100"

  return <div key={id} className={`collapse collapse-arrow join-item border border-base-300 ${isOpen ? 'collapse-open' : 'collapse-close'} group`} style={{visibility: 'visible'}}>
    <input type="radio" name="solutions" checked={isOpen} onChange={() => onToggle(id)} />
    <div className={`collapse-title text-xl font-medium cursor-pointer relative ${isOpen ? titleColor : "bg-inherit"}`}>
      <div className="font-bold">{(solution || "").substring(0, 20)}{(solution || "").length > 20 ? "…" : ""}</div>
      <div className="absolute top-1.5 right-10 opacity-0 group-hover:opacity-100 z-10" data-tip="Distribute reward and get 👍">
        <ThankButton hand={hand} solutionId={id}
                     giverRef={giver} thankRate={thankRate}
                     charity={charity} charityRate={charityRate}
                     maint={maint} maintRate={maintRate}
                     comment={comment} />
      </div>
    </div>
    <div className="collapse-content border-t-1 border-b-2">
      <div className="p-2">{solution}</div>
      <div className="divider font-bold">Thank Wisely</div>
      <div data-tip="Provide feedback and get additional 👍">
        <textarea className="textarea textarea-bordered w-full resize-none lg:resize-y min-h-16 h-24 md:h-8"
                  name="solution" placeholder="Comment" 
                  onChange={event => setComment(event.target.value)} />
      </div>
      <Slider label="Reward" value={thankRate} min={1} onChange={setThankRate} />
      <Slider label={charitySelector} value={charityRate} min={1} max={33} onChange={setCharityRate} />
      <Slider label="Maint." value={maintRate} max={33} onChange={setMaintRate} />
    </div>
  </div>
}


const Solutions = ({hand}) => {

  const [active, setActive] = useState(null)

  const {data: solutionsNumber} = useReadAHandSolutionsNumber({
    address: hand,
  })

  const solutions = [...Array(parseInt(solutionsNumber || 0)).keys()].slice().sort((a, b) => {
    if (a === active) return -1;
    if (b === active) return 1;
    return 0;
  })

  return <div className="join join-vertical w-full">
    { 
      solutions.map(id => 
        <Solution id={id} hand={hand} key={id} isOpen={active === id} 
                  onToggle={id => setActive(active === id ? null : id)} />)
    }
  </div>
}


const ShakeForm = ({params}) => {

  const [newRef] = useState(genRef())

  const [solution, setSolution] = useState()
  const [encrypted, setEncrypted] = useState(false)

  return <div>
    <SolutionInput solution={solution} setSolution={setSolution} encrypted={encrypted} setEncrypted={setEncrypted}/>
    <div className="card-actions justify-center mt-2 space-x-2">
      <div className="lg:tooltip" data-tip="Just share the problem to your peers and get rewarded if someone else provides a solution">
        <ShakeButton params={params} newRef={newRef} comment={solution} />
      </div>
      <div className="lg:tooltip" data-tip="Deliver to the problem's raiser"> 
        <GiveButton params={params} newRef={newRef} solution={solution} />
      </div>
    </div>
  </div>

}


export const Hand = ({params}) => {

  const [location, setLocation] = useLocation()

  const url = `${window.location.origin}/hand/${params.hand}/${params.ref}`
  
  const {address} = useAccount()
  const {data: raiser } = useReadAHandRaiser({
    address: params.hand,
  })

  raiser && address === raiser && !params.action && setLocation(`/hand/${params.hand}`)

  const action = params.action || "other"

  const msg = {
    "share": "Spread the hand!",
    "given": "Solution sent!",
    "thanked": "Thank you for thanking!",
  }[action]

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
