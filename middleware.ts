import { rewrite } from '@vercel/edge';


export default function middleware(request: Request) {
  const url = new URL(request.url);

  if (url.pathname.startsWith('/check')) {
    return rewrite(new URL('/check-check', request.url));
  }

}
