import { useEffect } from "react";

import { Link, Route, Redirect, Switch } from "wouter";

import { Notification, Header, BackButton, Body, Footer } from "./components";
import { Welcome, Raise, Hand, Hands, User, Page404 } from "./pages";


export function App() {

  return <div className="flex flex-col items-center min-h-screen px-2">
    <Notification />
    <Header />
    <Body>
      <Switch>
        <Route path="/" component={Welcome} />
        <Route path="/raise" component={Raise} />
        <Route path="/hands" component={Hands} />
        <Route path="/hand/:hand" component={Hand} />
        <Route path="/hand/:hand/:ref" component={Hand} />
        <Route path="/hand/:hand/:ref/:action" component={Hand} />
        <Route path="/user/:address" component={User} />
        <Route path="/404" component={Page404} />
        <Redirect to="/404" replace />
      </Switch>
    </Body>
    <Footer />
  </div>
}
