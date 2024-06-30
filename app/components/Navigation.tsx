import { useState, useEffect, useRef } from 'react'

import { Link, useLocation } from 'wouter'

import { useHistory } from '../Store'


export const BackButton = ({className = '', children = '←'}) => {

  const [localtion, setLocation] = useLocation()

  const addHistory = useHistory((state) => state.addHistory)
  const removeLastHistory = useHistory((state) => state.removeLastHistory)
  const history = useHistory((state) => state.history)

  const locationRef = useRef(location)

  useEffect(() => {
    if (locationRef.current.pathname !== location.pathname) {
      addHistory(location);
    }

    locationRef.current = location
  }, [location, addHistory])

  const handleBack = () => {
    const previousPath = history.length > 1 ? history[history.length - 2] : '/'; 

    removeLastHistory()
    setLocation(previousPath)
  }

  return (
    history.length > 0 && !['/', '/raise', '/hands'].includes(location.pathname)
      ?
        <button className={`btn btn-xs btn-ghost rounded-b-none ${className}`} title="Back" onClick={handleBack}>
          {children}
        </button>
      :
        ""
  )
}


export const Breadcrumbs = () => {
  const [location] = useLocation()

  const pathnames = location.split('/').filter((x) => x)

  return (
    <div className="text-sm breadcrumbs">
      <ul>
        {pathnames.map((name, index) => {
          const routeTo = `/${pathnames.slice(0, index + 1).join('/')}`
          const isLast = index === pathnames.length - 1

          return (
            <li key={name} style={{textTransform: 'capitalize'}}>
              {isLast ? (
                <span className="font-semibold">{name}</span>
              ) : (
                <Link href={routeTo}>{name}</Link>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
