import { copyToClipboard } from "@phntms/react-share";

import { useLocation } from "wouter";


export const Share = ({url}) => {

  return <div className="flex flex-col md:flex-row space-y-2 md:space-y-0 md:space-x-2">
      <button
        className="bg-blue-600 text-white px-4 py-2 rounded"
        onClick={() =>
          window.open(`https://twitter.com/intent/tweet?url=${url}`, "_blank")
        }>
        Share on Twitter
      </button>

      <button
        className="bg-blue-800 text-white px-4 py-2 rounded"
        onClick={() =>
          window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, "_blank")
        }
      >
        Share on Facebook
      </button>

      <button className="bg-gray-600 text-white px-4 py-2 rounded" onClick={() => copyToClipboard(url)}></button>
  </div>
}
