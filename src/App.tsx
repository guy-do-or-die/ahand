import { useEffect } from "react";
import { useAccount } from "wagmi";

import { Link, Route } from "wouter";

import { Notification, Header, Body, Footer } from "./components";
import { Welcome, Hand, Hands, Raise, Solution } from "./pages";


export function App() {

  return <div className="flex flex-col items-center min-h-screen">
    <Notification />
    <Header />
    <Body>
      <Route path="/" component={Welcome} />
      <Route path="/raise" component={Raise} />
      <Route path="/hands" component={Hands} />
      <Route path="/hand/:hand" component={Hand} />
      <Route path="/hand/:hand/:ref" component={Hand} />
      <Route path="/hand/:hand/:ref/:action" component={Hand} />
    </Body>
    <Footer />
  </div>
}
