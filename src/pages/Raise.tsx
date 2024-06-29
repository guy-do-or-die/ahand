import { useState, useEffect, useRef } from "react"
import { parseEther, formatEther } from "viem"
import { useLocation } from "wouter"

import { useBlockNumber } from "wagmi"

import { usePrivy } from "@privy-io/react-auth"

import { Button, parseError } from "../components"

import { notify, hide } from "../components/Notification"

import { useAccount } from "../wallet"
import { genRef } from "../utils"

import {
  useReadAHandBaseMinimumReward,
  useSimulateAHandBaseRaise,
  useWriteAHandBaseRaise,
  useWatchAHandBaseRaisedEvent,
} from "../contracts"


export const Raise = () => {

  const [location, setLocation] = useLocation()

  const {ready, authenticated} = usePrivy()
  const {address, chain} = useAccount()

  !authenticated && setLocation('/')

  const {data: minReward} = useReadAHandBaseMinimumReward()

  const [block, setBlock] = useState(0)

  const [problem, setProblem] = useState()
  const [link, setLink] = useState("")

  const [reward, setReward] = useState("")

  useEffect(() => {
    !ready || !authenticated && setLocation("/")
  }, [ready, authenticated])

  const [ref, setRef] = useState(genRef())

  const [pending, setPending] = useState(false)

  const preparingNotificationId = 'preparing-notification'

  const raiseParams = {
    args: [problem, link, ref],
    value: parseEther(reward),
    enabled: problem?.length > 0 && parseFloat(reward) > 0,
    pendingCallback: () => {
      setPending(true)
    },
    confirmationCallback: ({data, error}) => {
      notify('Preparing for sharing...', 'loading', {id: preparingNotificationId, duration: Infinity})
    }
  }

  useWatchAHandBaseRaisedEvent({
    enabled: pending,
    onError: error => {
      notify(parseError(error), 'error') 
      hide(preparingNotificationId)
    },
    onLogs: logs => {
      (logs || []).every(item => {
        const {hand, raiser} = item.args

        if (raiser === address) {
          setLocation(`/hand/${hand}/${ref}/share`)
          hide(preparingNotificationId)
          return
        }
      })

    }
  })

  const problemRef = useRef(null);

  useEffect(() => {
    problemRef.current.focus();
  }, []);

  const handleRewardFocus = (event) => {
    if (reward === '') {
      setReward(formatEther(minReward))
    }
  }

  const handleRewardChange = (event) => {
    const value = event.target.value

    if (
      value === ''
      || value === '.'
      || value === '0.'
      || (/^\d*\.?\d+$/.test(value) && parseFloat(value) >= 0)
    ) {
      setReward(value)
    }
  }

  const rewardPattern = "^(0*?[1-9]\d*(\.\d+)?|0*\.\d*[1-9]\d*)$"

  return <div>
    <div className="lg:tooltip w-full h-48 md:h-32" data-tip="Type or paste a link to your problem description">
    <textarea className="textarea textarea-bordered w-full resize-none lg:resize-y min-h-32 h-48 md:h-32"
              name="problem" placeholder="Problem" ref={problemRef} onChange={event => setProblem(event.target.value)} />
    </div>
    <div className="card-actions flex justify-center mt-2">
      <div className="lg:tooltip" data-tip="Set a fair reward for solution chain participants">
      <input type="text" placeholder="Reward" className="input input-bordered w-32 sm:w-full text-center"
             value={reward} onFocus={handleRewardFocus} onChange={handleRewardChange} pattern={rewardPattern} />
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
