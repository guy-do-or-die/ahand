export const Address = ({ address, maxChars = 10 }) => {

  const shrink = (address, maxChars) => {
    if (!address) return 'n/a'

    if (address.length <= maxChars) return address

    const charsToShow = maxChars / 2

    const firstPart = address.slice(0, charsToShow)
    const secondPart = address.slice(-charsToShow)

    return `${firstPart}...${secondPart}`
  }

  return (
    <div className="w-full text-center">
      {shrink(address, maxChars)}
    </div>
  )
}
