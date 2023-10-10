import { useEffect } from "react";
import { useAccount } from "wagmi";

import { Link, Route } from "wouter";

import { Header, Body, Footer } from "./components";
import { Welcome, Hand, Raise, Shake, Give, Solution } from "./pages";


export function App() {

  return <div className="flex flex-col items-center min-h-screen">
    <Header />
    <Body>
      <Route path="/" component={Welcome} />
      <Route path="/raise" component={Raise} />
      <Route path="/hand/:hand" component={Hand} />
      <Route path="/hand/:hand/shake/:ref" component={Shake} />
      <Route path="/hand/:hand/give/:ref" component={Give} />
    </Body>
    <Footer />
  </div>
}
