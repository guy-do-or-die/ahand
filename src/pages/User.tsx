import { useState, useRef, useEffect } from "react"

import { useSpring, animated } from '@react-spring/web'
import { useDrag } from '@use-gesture/react'

import { useBalance } from "wagmi"
import { formatEther } from "viem"

import { useLocation } from "wouter"

import { useAccount } from "../wallet"
import { Button } from "../components"

import {
  useSimulateAHandBaseThumbUp,
  useSimulateAHandBaseThumbDown,
  useWriteAHandBaseThumbUp,
  useWriteAHandBaseThumbDown,
  useWriteAHandBaseBalanceOf,
  useReadAHandBaseTrust,
} from "../contracts"


const ThumbUpButton = params => {

  const [location, setLocation] = useLocation()

  const thumbUpParams = {
    args: [params.address],
    enabled: params.ups > 0,
    onConfirmationSuccess: data => {
      console.log('!') 
    }
  }

  return <Button emoji="👍" text="Up" 
                 simulateHook={useSimulateAHandBaseThumbUp}
                 writeHook={useWriteAHandBaseThumbUp}
                 params={thumbUpParams} />
}


const ThumbDownButton = params => {

  const [location, setLocation] = useLocation()

  const thumbDownParams = {
    args: [params.address],
    enabled: params.ups > 0,
    onConfirmationSuccess: data => {
      console.log('!') 
    }
  }

  return <Button emoji="👎" text="Down" 
                 simulateHook={useSimulateAHandBaseThumbDown}
                 writeHook={useWriteAHandBaseThumbDown}
                 params={thumbDownParams} />
}


const Actions = params => {

  return <div>
    <div className="card-actions justify-center mt-2 space-x-2">
      <div className="lg:tooltip" data-tip="Pay respect with 👍">
        <ThumbUpButton params={params} />
      </div>
      <div className="lg:tooltip" data-tip="Sacrifice 👍 to mark a bad player">
        <ThumbDownButton params={params} />
      </div>
    </div>
  </div>

}


export const User = ({params}) => {

  const [location, setLocation] = useLocation()

  const {address} = useAccount()

  return <div>
    <div className="card-title text-center mb-8 text-xl md:text-2xl lg:text-3xl justify-center">
      {address}
    </div>
    <Actions address={params.address} />
  </div>
}
