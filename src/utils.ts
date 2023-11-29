
export const genRef = () => {
  const array = new Uint8Array(20);
  window.crypto.getRandomValues(array);
  return "0x" + Array.from(array).map(b => b.toString(16).padStart(2, "0")).join("");
}
