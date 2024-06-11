

export const Body = ({props, children}) => {
  return <div className="card w-96 bg-base-100 shadow-xl mt-auto w-full sm:w-2/3 md:w-3/5 lg:w-2/5">
    <div className="card-body">
      {children}
    </div>
  </div>
}
