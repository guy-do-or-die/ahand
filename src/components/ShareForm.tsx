import { ShareSocial } from "react-share-social"; 


export const ShareForm = ({url}) => {

  const style = {
    root: {
      maxWidth: "100%",
      width: "100%",
    },
    iconContainer: {
      textAlign: "center"   
    },
    copyContainer: {
      border: 0,
    },
    copyUrl: {
      color: "black",
      overflowX: "hidden",
    },
    copyIcon: {
      color: "#000",
    }
  };

  return <div className="w-full">
    <ShareSocial url={url} style={style} socialTypes={["twitter", "telegram", "reddit", "linkedin", "facebook"]} />
  </div>
}
