import { Toaster, toast } from "react-hot-toast"


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


export const notify = (content, type, params) => {
  const defaultParams = {
    "error": {
      duration: 5000,
    },
    "success": {
      duration: 3000,
    }
  }[type] || {}

  if (content) {
    return (toast[type] || toast)(content, {...defaultParams, ...params})
  }
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
