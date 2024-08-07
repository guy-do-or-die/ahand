import { useLocation } from "wouter"

import { CopyToClipboard } from 'react-copy-to-clipboard'
import { Name } from '@coinbase/onchainkit/identity'

import { useAccount } from "../wallet"

import { Button, UserStat, notify } from "../components"

import {
  useReadAHandBaseBalanceOf,
  useSimulateAHandBaseThumbUp,
  useSimulateAHandBaseThumbDown,
  useWriteAHandBaseThumbUp,
  useWriteAHandBaseThumbDown,
} from "../contracts"


const ThumbUpButton = ({address, ups}) => {

  const [location, setLocation] = useLocation()

  const thumbUpParams = {
    args: [address],
    enabled: ups > 0,
    onConfirmationSuccess: data => {
      console.log('!') 
    }
  }

  return <Button emoji="👍" text="Up" 
                 simulateHook={useSimulateAHandBaseThumbUp}
                 writeHook={useWriteAHandBaseThumbUp}
                 params={thumbUpParams} />
}


const ThumbDownButton = ({address, ups}) => {

  const [location, setLocation] = useLocation()

  const thumbDownParams = {
    args: [address],
    enabled: ups > 0,
    onConfirmationSuccess: data => {
      console.log('!') 
    }
  }

  return <Button emoji="👎" text="Down" 
                 simulateHook={useSimulateAHandBaseThumbDown}
                 writeHook={useWriteAHandBaseThumbDown}
                 params={thumbDownParams} />
}


const Actions = ({address}) => {

  const {address: actorAddress} = useAccount()

  const {data: ups} = useReadAHandBaseBalanceOf({
    args: [actorAddress, 4],
  })

  return <div>
    {
      address !== actorAddress ?
        <div className="card-actions justify-center mt-2 space-x-2">
          <div className="lg:tooltip" data-tip="Pay respect with your 👍">
            <ThumbUpButton address={address} ups={ups} />
          </div>
          <div className="lg:tooltip" data-tip="Sacrifice 👍 to mark a bad player">
            <ThumbDownButton address={address} ups={ups} />
          </div>
        </div>
      :
        ""
    }
  </div>

}


export const User = ({params}) => {

  const [location, setLocation] = useLocation()

  const address = params.address

  return <div>
    <div className="card-title text-center mb-8 text-xl md:text-2xl lg:text-3xl justify-center cursor-pointer">
      <CopyToClipboard text={address} onCopy={() => notify(`Copied to Clipboard`, 'success', {duration: 1000})}>
        <span><Name address={address} /></span>
      </CopyToClipboard>
    </div>
    <div className="mb-8">
      <UserStat address={address} />
    </div>
    <Actions address={address} />
  </div>
}
