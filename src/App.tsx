import { useEffect } from "react";
import { useAccount } from "wagmi";

import { Link, Route } from "wouter";

import { Header, Body, Footer } from "./components";
import { Welcome, Hand, Hands, Raise, Share, Give, Solution } from "./pages";


export function App() {

  return <div className="flex flex-col items-center min-h-screen">
    <Header />
    <Body>
      <Route path="/" component={Welcome} />
      <Route path="/raise" component={Raise} />
      <Route path="/hands" component={Hands} />
      <Route path="/hand/:hand/:ref" component={Hand} />
      <Route path="/hand/:hand/:ref/share" component={Share} />
    </Body>
    <Footer />
  </div>
}
