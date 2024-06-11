import { useEffect } from "react";

import { usePrivy } from "@privy-io/react-auth";

import { useLocation } from "wouter";


export const Welcome = () => {

  const {ready, authenticated, login} = usePrivy();

  const [location, setLocation] = useLocation();

  useEffect(() => {
    ready && authenticated && setLocation("/raise");
  }, [ready, authenticated])

  return <div className="items-center justify-center">
    <div className="text-center space-y-4 mb-10">
      <div className="text-xl">
        <span className="text-2xl font-bold">✋ Raise</span> to find a solution for any problem via few handshakes
      </div>
      <div className="text-xl">
        <span className="text-2xl font-bold">🤝 Shake</span> and share to recieve a part of the reward
      </div>
      <div className="text-xl">
        <span className="text-2xl font-bold">🙌 Give</span> a solution and get rewarded
      </div>
    </div>
    <div className="text-center">
      <div className="text-3xl">A hand is near,</div>
        <div className="text-5xl font-bold transform transition hover:animate-handshake">
        <a href="#" onClick={login}>shake it!</a>
      </div>
    </div>
  </div>
}
