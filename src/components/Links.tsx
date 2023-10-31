import { useNetwork } from 'wagmi';

import { aHandBaseAddress } from '../contracts';

import xUrl from '../../assets/x.png';
import telegramUrl from '../../assets/telegram.png';
import discordUrl from '../../assets/discord.png';
import guildUrl from '../../assets/guild.png';
import gitUrl from '../../assets/git.png';
import etherscanUrl from '../../assets/etherscan.png';
import donateUrl from '../../assets/donate.png';


const Link = ({href, icon, title}) => {
  return <a href={href} target="_blank" rel="noopener noreferrer"
            className="text-blue-500 hover:text-blue-700 transition">
    <img src={icon} alt={title} title={title} className="w-6 h-6 hover:opacity-75 transition" />
  </a>
}


export const Links = () => {
  const { chain } = useNetwork();

  const etherscan = chain?.blockExplorers?.etherscan.url;
  const contractAddress = aHandBaseAddress[chain?.id];

  return <div className="flex justify-center items-start"> 
    <div className="flex space-x-4 filter grayscale">
      <Link title="X" href="http://x.com/ahand_social" icon={xUrl} />
      <Link title="Telegram" href="https://t.me/" icon={telegramUrl} />
      <Link title="Discord" href="https://discord.gg/" icon={discordUrl} />
      <Link title="Guild" href="https://guild.xyz/ahand" icon={guildUrl} />
      <Link title="Code" href="https://gitlab.com/the-gethering/ahand" icon={gitUrl} />
      {chain ? <Link title="Contract" href={`${etherscan}/address/${contractAddress}#code`} icon={etherscanUrl} /> : ""}
      {false ? <Link title="Donate" href="" icon={donateUrl} /> : ""}
    </div>
  </div>
}
