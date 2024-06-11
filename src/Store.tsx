import { create } from 'zustand'
import { persist } from 'zustand/middleware'


export const useConfig = create(
  persist(
    set => ({
      config: {},
      setConfig: (key: string, value: any) => set(
        state => ({config: {...state.config, [key]: value}})
      )
    }),
    {
      name: 'global-config'
    }
  )
)
