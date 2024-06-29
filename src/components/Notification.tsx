import { Toaster, toast } from "react-hot-toast"

import { CopyToClipboard } from 'react-copy-to-clipboard'


export const parseError = (error) => {

  const templates = [
    /following reason:\n(.*?)\n/s,
    /(The total cost (.+?) exceeds the balance of the account)/,
    /(User rejected the request)/,
    /(Execution reverted for an unknown reason)/,
    /(The contract function (.+?) reverted)/,
    /(Invalid UserOp signature or paymaster signature)/,
    /(RPC Error)/,
  ]

  let msg

  if (error) {
    console.log(error)
    msg = error.message

    templates.some(template => {
      const matches = msg.match(template)

      if (matches && matches[1]) {
        msg = matches[1].trim()
        return true 
      }
    })
  }

  return msg
}


export const notify = (content, typ, params) => {
  const defaultParams = {
    "error": {
      duration: 5000,
    },
    "success": {
      duration: 3000,
    }
  }[typ] || {}

  if (content) {
    const contentEl = (typ === 'error' && typeof conent === 'string') ? (
      <CopyToClipboard text={conent} onCopy={() => notify(`Copied to Clipboard`, 'success', {duration: 1000})}>
        conent
      </CopyToClipboard>
    ) : content

    return (toast[typ] || toast)(contentEl, {...defaultParams, ...params})
  }
}


export const notImplemented = () => {
  return notify('Feature is not ready just yet', 'info', {icon: '😬'})
}


export const hide = id => {
  toast.dismiss(id)
}


export const Notification = ({}) => {
  return <>
    <Toaster toastOptions={{
      className: 'light:!bg-white light:!text-black dark:!bg-black dark:!text-white',
    }}/>
  </>
}
