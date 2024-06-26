import { useState, useEffect } from "react"
import { parseEther } from "viem"
import { useLocation } from "wouter"

import { useBlockNumber } from "wagmi"

import { usePrivy } from "@privy-io/react-auth"

import { Button, parseError } from "../components"

import { notify, hide } from "../components/Notification"

import { useAccount } from "../wallet"
import { genRef } from "../utils"

import {
  useSimulateAHandBaseRaise,
  useWriteAHandBaseRaise,
  useWatchAHandBaseRaisedEvent,
} from "../contracts"


export const Raise = () => {

  const [location, setLocation] = useLocation()

  const {ready, authenticated} = usePrivy()
  const {address, chain} = useAccount()

  !authenticated && setLocation('/')

  const [block, setBlock] = useState(0)

  const [problem, setProblem] = useState()
  const [link, setLink] = useState("")

  const [reward, setReward] = useState("")

  useEffect(() => {
    !ready || !authenticated && setLocation("/")
  }, [ready, authenticated])

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

  const [ref, setRef] = useState(genRef())

  const [confirmed, setConfirmed] = useState(false)

  const preparingNotificationId = 'preparing-notification'

  const raiseParams = {
    args: [problem, link, ref],
    value: parseEther(reward),
    enabled: problem?.length > 0 && parseFloat(reward) > 0,
    writeCallback: ({data, error}) => {
      setConfirmed(true)
    },
    confirmationCallback: ({data, error}) => {
      notify('Preparing for sharing...', 'loading', {id: preparingNotificationId, duration: Infinity})
    }
  }

  useWatchAHandBaseRaisedEvent({
    enabled: confirmed,
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

  return <div>
    <div className="lg:tooltip w-full h-48 md:h-32" data-tip="Type or paste a link to your problem description">
      <textarea className="textarea textarea-bordered w-full resize-none lg:resize-y min-h-32 h-48 md:h-32" name="problem" placeholder="Problem" onChange={event => setProblem(event.target.value)} />
    </div>
    <div className="card-actions justify-center mt-2">
      <div className="lg:tooltip w-full max-w-xs" data-tip="Set a fair reward for solution chain participants">
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
