import { useEffect } from "react";

import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useAccount } from "wagmi";

import { useLocation } from "wouter";


export const Welcome = () => {

  const { openConnectModal } = useConnectModal(); 
  const { isConnected } = useAccount();

  const [location, setLocation] = useLocation();

  useEffect(() => {
    isConnected && setLocation("/raise");
  }, [isConnected])

  return <div className="flex items-center justify-center flex-grow">
    <div className="font-pixel text-center ">
      <div className="text-4xl">A hand is near</div>
      <div className="font-bold text-6xl"><a href="#" onClick={openConnectModal}>Shake it!</a></div>
    </div>
  </div>
}
