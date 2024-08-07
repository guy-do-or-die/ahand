import { FrameMetadata } from '@coinbase/onchainkit/frame'


export const WelcomeFrame = () => {
  return (
    <FrameMetadata
      buttons={[
        {
          label: 'Tell me the story',
        },
        {
          action: 'link',
          label: 'Link to Google',
          target: 'https://www.google.com'
        },
        {
          action: 'post_redirect',
          label: 'Redirect to cute pictures',
        },
      ]}
      image={{
       src: 'https://www.google.com/images/branding/googlelogo/1x/googlelogo_light_color_272x92dp.png',
       aspectRatio: '1:1'
      }}
      input={{
        text: 'Tell me a boat story',
      }}
      state={{
        counter: 1,
      }}
    />
  )
}
