import { next, rewrite } from '@vercel/edge'

const FC_USER_AGENT = 'FCBot/0.1 (like TwitterBot)'


export default function middleware(request: Request, ) {

  const url = new URL(request.url)
  const shouldRedirect = url.pathname.startsWith('/hand/')
  const isFromFrame = request.headers.get('user-agent') === FC_USER_AGENT 

  if (shouldRedirect) {
    return rewrite(new URL(`/api/frame?path=${url.pathname}`, request.url))
  }

  return next()
}
