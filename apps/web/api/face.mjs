// The Vercel Function of the public test deployment: face's link previews for a Hand's address
// and its card (docs/public-test-deployment.md). Written by `bun apps/hand/vercel.ts write`;
// ../face/ is made by the build command (apps/hand/vercel.ts buildFunction) before Vercel traces this file.
export { default } from "../face/handler.mjs";
