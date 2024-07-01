import crypto from 'crypto'


export const genRef = (): string => {
  let array: Uint8Array

  if (typeof window !== 'undefined' && window.crypto) {
    array = new Uint8Array(20)
    window.crypto.getRandomValues(array)
  } else {
    array = new Uint8Array(crypto.randomBytes(20))
  }

  return "0x" + Array.from(array).map(b => b.toString(16).padStart(2, "0")).join("")
}
