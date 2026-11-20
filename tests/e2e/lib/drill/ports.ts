/**
 * The drill spec's connection attempt: is anything listening on 127.0.0.1:port? A stopped
 * service must refuse; this is how the spec proves "nothing serves the app".
 */
import { createConnection } from "node:net";

export function listening(port: number, timeoutMs = 1_500): Promise<boolean> {
  return new Promise((done) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (open: boolean) => {
      socket.destroy();
      done(open);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}
