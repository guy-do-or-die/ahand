import { Link } from "wouter";

import {
  useReadAHandBaseHandsNumber,
  useReadAHandBaseHands,
} from "../contracts";


export const HandsItem = ({id}) => {

  const { data: hand } = useReadAHandBaseHands({
    args: [id],
  });

  return <div key={id}>
    <Link href={`/hand/${hand}`}>{hand}</Link>
  </div>
}


export const Hands = () => {

  const { data: handsNumber } = useReadAHandBaseHandsNumber({
    watch: true,
  });

  return <div>
    { [...Array(parseInt(handsNumber || 0)).keys()].map(id => <HandsItem id={id} />) }  
  </div>
}
