import { ConnectButton } from "@rainbow-me/rainbowkit";

import { Link } from "wouter";


const Logo = () => {
  return <div className="mx-5 mb-4 cursor-pointer" title="Raise, shake, give and get rewarded!">
    <Link href="/">
      <span className="text-6xl sm:text-5xl">a</span>
      <span className="font-bold text-7xl sm:text-6xl">🙌</span>
      <span className="text-6xl sm:text-5xl">and</span>
    </Link>
  </div>
}


export const Header = () => {
  return <div className="flex flex-col items-center justify-start w-full sm:flex-row sm:justify-between p-2">
    <div className="w-full text-center sm:text-left">
      <Logo />
    </div>

    <div className="order-1 m-4 sm:m-0 sm:order-2 sm:absolute sm:top-5 sm:right-6">
      <ConnectButton label="Sign In" accountStatus="address" chainStatus="icon" />
    </div>
  </div>
}
