import { Toaster, toast } from "react-hot-toast"


export const notify = (content, type, params) => {
  const defaultParams = {
    "error": {

    },
    "success": {
      duration: 5000,
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
