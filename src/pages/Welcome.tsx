import { useEffect } from "react";

import { usePrivy } from "@privy-io/react-auth";

import { useLocation } from "wouter";


export const Welcome = () => {

  const {ready, authenticated, login} = usePrivy();

  const [location, setLocation] = useLocation();

  useEffect(() => {
    ready && authenticated && setLocation("/raise");
  }, [ready, authenticated])

  return <div className="flex items-center justify-center flex-grow">
    <div className="font-pixel text-center ">
      <div className="text-4xl">A hand is near</div>
      <div className="font-bold text-6xl"><a href="#" onClick={login}>Shake it!</a></div>
    </div>
  </div>
}
