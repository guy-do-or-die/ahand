import { MiddlewareRequest, MiddlewareResponse } from "vite-vercel/server"


export default (req: MiddlewareRequest) => {
  const url = new URL(req.url)

  if (url.pathname === "/from-middleware") {
    return new Response("from middleware")
  }

  if (url.pathname === "/todo") {
    return MiddlewareResponse.rewrite(
      "https://jsonplaceholder.typicode.com/todos/1",
    )
  }

  return MiddlewareResponse.next()
}
