// The Vercel Function of the public test deployment: the view server's link previews for a Hand's address
// and its card (docs/public-test-deployment.md). Written by `bun apps/web/deploy.ts write`;
// ../view/ is made by the build command (apps/web/deploy.ts buildFunction) before Vercel traces this file.
export { default } from "../view/handler.mjs";
