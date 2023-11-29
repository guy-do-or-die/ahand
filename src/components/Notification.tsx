import { Toaster, toast } from "react-hot-toast";


export const notify = (content, type, params) => {
  const defaultParams = {
    "error": {

    },
    "success": {
      duration: 5000,
    }
  }[type] || {};

  return content && (toast[type] || toast)(content, {...defaultParams, ...params});
}


export const Notification = ({}) => {
  return <>
    <Toaster />
  </>
}
